'use strict';

// Provider adapters. A preset without a matching protocol is a lie: each
// provider below has its own request shape, auth header and response field.
// Every adapter goes through the same timeout, and failures propagate so the
// recording is preserved by the caller.
const fs = require('fs');
const { extensionForMime } = require('./media');

const POLL_INTERVAL_MS = 2000;
const CARTESIA_VERSION = '2026-03-01';

function assertKey(profile, label) {
  if (!profile || !profile.apiKey) throw new Error(`${label} API key not configured. Go to Settings.`);
}

async function readBlobFile(audioPath, mimeType) {
  const buffer = fs.readFileSync(audioPath);
  const type = mimeType || 'application/octet-stream';
  return new Blob([buffer], { type });
}

function filenameFor(mimeType) {
  return `audio.${extensionForMime(mimeType)}`;
}

async function transcribeWithElevenLabs(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  assertKey(profile, 'ElevenLabs');

  const form = new FormData();
  form.append('file', await readBlobFile(audioPath, mimeType), filenameFor(mimeType));
  form.append('model_id', profile.model || 'scribe_v2');
  if (opts.language) form.append('language_code', opts.language);
  // The vocabulary hint maps to ElevenLabs keyterms (a bias list).
  if (opts.hint) form.append('keyterms', opts.hint);

  const resp = await fetchImpl('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': profile.apiKey },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw providerError('ElevenLabs', resp);
  const data = await resp.json();
  return data.text || '';
}

async function transcribeWithDeepgram(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  assertKey(profile, 'Deepgram');

  const params = new URLSearchParams();
  params.set('model', profile.model || 'nova-3');
  params.set('smart_format', 'true');
  if (opts.language) params.set('language', opts.language);
  if (opts.hint) {
    for (const term of String(opts.hint).split(/[,;]/).map(t => t.trim()).filter(Boolean)) {
      params.append('keywords', term);
    }
  }

  const resp = await fetchImpl(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    // Deepgram uses "Token", not "Bearer".
    headers: { 'Authorization': `Token ${profile.apiKey}`, 'Content-Type': mimeType || 'application/octet-stream' },
    body: fs.readFileSync(audioPath),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw providerError('Deepgram', resp);
  const data = await resp.json();
  return data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
}

async function transcribeWithCohere(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  assertKey(profile, 'Cohere');

  const form = new FormData();
  form.append('file', await readBlobFile(audioPath, mimeType), filenameFor(mimeType));
  if (profile.model) form.append('model', profile.model);
  // Cohere has no vocabulary-bias mechanism; the hint is ignored here on purpose.
  if (opts.language) form.append('language', opts.language);

  const resp = await fetchImpl('https://api.cohere.com/v2/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${profile.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) throw providerError('Cohere', resp);
  const data = await resp.json();
  return data.text || data.transcript || '';
}

async function transcribeWithAssemblyAI(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  const pollEvery = opts.pollIntervalMs == null ? POLL_INTERVAL_MS : opts.pollIntervalMs;
  assertKey(profile, 'AssemblyAI');

  const upload = await fetchImpl('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: { 'authorization': profile.apiKey, 'Content-Type': mimeType || 'application/octet-stream' },
    body: fs.readFileSync(audioPath),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!upload.ok) throw providerError('AssemblyAI upload', upload);
  const { upload_url: uploadUrl } = await upload.json();
  if (!uploadUrl) throw new Error('AssemblyAI upload did not return a URL.');

  const create = await fetchImpl('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'authorization': profile.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: uploadUrl,
      ...(opts.language ? { language_code: opts.language } : {}),
      ...(opts.hint ? { word_boost: String(opts.hint).split(/[,;]/).map(t => t.trim()).filter(Boolean) } : {})
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!create.ok) throw providerError('AssemblyAI', create);
  const job = await create.json();
  if (!job.id) throw new Error('AssemblyAI did not return a transcript id.');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw abortError();
    const poll = await fetchImpl(`https://api.assemblyai.com/v2/transcript/${job.id}`, {
      method: 'GET',
      headers: { 'authorization': profile.apiKey },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!poll.ok) throw providerError('AssemblyAI poll', poll);
    const data = await poll.json();
    if (data.status === 'completed') return data.text || '';
    if (data.status === 'error') throw new Error('AssemblyAI transcription failed: ' + (data.error || 'unknown error'));
    await sleep(pollEvery);
  }
  throw new Error('AssemblyAI transcription timed out.');
}

async function transcribeWithCorti(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  const pollEvery = opts.pollIntervalMs == null ? POLL_INTERVAL_MS : opts.pollIntervalMs;
  const base = (profile.baseUrl || 'https://api.corti.ai').replace(/\/+$/, '');
  assertKey(profile, 'Corti');

  const form = new FormData();
  form.append('file', await readBlobFile(audioPath, mimeType), filenameFor(mimeType));
  const upload = await fetchImpl(`${base}/v1/recordings`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${profile.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!upload.ok) throw providerError('Corti upload', upload);
  const uploaded = await upload.json();
  const recordingId = uploaded.recordingId || uploaded.id || uploaded.recording?.id;
  if (!recordingId) throw new Error('Corti did not return a recording id.');

  const create = await fetchImpl(`${base}/v1/transcripts`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${profile.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recordingId,
      ...(profile.model ? { modelName: profile.model } : {}),
      ...(opts.language ? { primaryLanguage: opts.language } : {})
    }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!create.ok) throw providerError('Corti', create);
  const job = await create.json();
  const transcriptId = job.transcriptId || job.id || job.transcript?.id;
  if (!transcriptId) throw new Error('Corti did not return a transcript id.');

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (opts.signal?.aborted) throw abortError();
    const poll = await fetchImpl(`${base}/v1/transcripts/${transcriptId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${profile.apiKey}` },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!poll.ok) throw providerError('Corti poll', poll);
    const data = await poll.json();
    const status = String(data.status || '').toLowerCase();
    if (['completed', 'done', 'succeeded'].includes(status)) {
      if (typeof data.text === 'string' && data.text) return data.text;
      const segments = data.transcript || data.segments || [];
      if (Array.isArray(segments)) {
        return segments.map(s => s.text || s.transcript || '').join(' ').trim();
      }
      return '';
    }
    if (['failed', 'error', 'cancelled'].includes(status)) {
      throw new Error('Corti transcription failed: ' + (data.error || data.message || status));
    }
    await sleep(pollEvery);
  }
  throw new Error('Corti transcription timed out.');
}

// Gemini 3.5 Transcribe is a dedicated speech-to-text model on the native
// generateContent API. It is not the OpenAI-compatible chat path used by the
// Gemini multimodal models, so it gets its own protocol.
async function transcribeWithGeminiTranscribe(opts) {
  const { audioPath, mimeType, profile } = opts;
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs || 120000;
  assertKey(profile, 'Gemini Transcribe');

  const base = (profile.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
  const model = profile.model || 'gemini-3.5-transcribe';
  const audio = fs.readFileSync(audioPath).toString('base64');
  const mime = mimeType || 'audio/wav';

  const generationConfig = {};
  const language = opts.language;
  const hint = opts.hint;
  if (language || hint) {
    const cfg = {};
    if (language) cfg.languageCodes = [language];
    if (hint) cfg.customVocabulary = String(hint).split(/[,;]/).map(t => t.trim()).filter(Boolean);
    generationConfig.audioTranscriptionConfig = cfg;
  }

  const body = {
    contents: [{ parts: [{ inlineData: { mimeType: mime, data: audio } }] }],
    ...(Object.keys(generationConfig).length ? { generationConfig } : {})
  };

  const resp = await fetchImpl(`${base}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': profile.apiKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const err = new Error(`Gemini Transcribe failed (${resp.status})${detail ? ': ' + detail.slice(0, 300) : ''}`);
    err.status = resp.status;
    throw err;
  }
  const data = await resp.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map(p => p?.text || '').filter(Boolean).join('').trim();
  if (text) return text;
  const direct = data?.transcription || data?.candidates?.[0]?.transcription;
  if (typeof direct === 'string') return direct;
  if (direct && typeof direct === 'object' && Array.isArray(direct.segments)) {
    return direct.segments.map(s => s.text || '').join('').trim();
  }
  return '';
}

/**
 * Cartesia ink-2 over WebSocket. The client uploads 16 kHz mono WAV/PCM for
 * this protocol (browser decodes MediaRecorder output first), so no ffmpeg is
 * needed on the server.
 */
async function transcribeWithCartesia(opts) {
  const { audioPath, profile } = opts;
  // Node's built-in WebSocket cannot send custom headers (Cartesia needs
  // X-API-Key), so the `ws` client is the default implementation.
  const WebSocketImpl = opts.WebSocketImpl || require('ws');
  const timeoutMs = opts.timeoutMs || 120000;
  assertKey(profile, 'Cartesia');
  if (!WebSocketImpl) throw new Error('Cartesia needs WebSocket support (Node 22+).');

  const pcm = opts.pcm || pcmFromFile(audioPath);
  if (!pcm.length) throw new Error('Cartesia received no PCM audio.');

  const params = new URLSearchParams({
    model: profile.model || 'ink-2',
    encoding: 'pcm_s16le',
    sample_rate: '16000',
    cartesia_version: CARTESIA_VERSION
  });
  const url = `wss://api.cartesia.ai/stt/websocket?${params.toString()}`;

  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const finish = (err, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (err) reject(err); else resolve(text || '');
    };
    const timer = setTimeout(() => finish(new Error('Cartesia transcription timed out.')), timeoutMs);
    if (opts.signal?.aborted) return finish(abortError());

    const ws = new WebSocketImpl(url, {
      headers: { 'X-API-Key': profile.apiKey }
    });

    ws.addEventListener('open', () => {
      // 100 ms frames at 16 kHz mono s16le.
      const frameSize = 3200;
      for (let i = 0; i < pcm.length; i += frameSize) {
        ws.send(pcm.subarray(i, i + frameSize));
      }
      ws.send(JSON.stringify({ type: 'finalize' }));
    });

    const onMessage = (event) => {
      let data;
      try { data = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); }
      catch { return; }
      if (data.type === 'error' || data.error) {
        return finish(new Error('Cartesia transcription failed: ' + (data.error || data.message || 'unknown error')));
      }
      const text = data.text || data.transcript || '';
      if (text) chunks.push({ text, final: !!(data.is_final || data.final) });
      if (data.is_final || data.final || data.type === 'done' || data.type === 'final') {
        const finalText = chunks.filter(c => c.final).map(c => c.text).join(' ').trim()
          || chunks.map(c => c.text).join(' ').trim();
        finish(null, finalText);
      }
    };
    if (typeof ws.addEventListener === 'function') {
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', () => finish(new Error('Cartesia WebSocket error.')));
      ws.addEventListener('close', () => {
        if (!settled) finish(null, chunks.map(c => c.text).join(' ').trim());
      });
    } else {
      ws.on('message', (raw) => onMessage({ data: raw.toString() }));
      ws.on('error', () => finish(new Error('Cartesia WebSocket error.')));
      ws.on('close', () => { if (!settled) finish(null, chunks.map(c => c.text).join(' ').trim()); });
    }
  });
}

function pcmFromFile(audioPath) {
  return pcmFromWav(fs.readFileSync(audioPath));
}

/** Strip the 44-byte canonical WAV header (and any chunks) down to s16le PCM. */
function pcmFromWav(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Cartesia needs WAV audio. Re-record or upload a WAV file.');
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'data') return buffer.subarray(body, Math.min(body + size, buffer.length));
    offset = body + size + (size % 2);
  }
  throw new Error('WAV file has no data chunk.');
}

function providerError(label, resp) {
  const err = new Error(`${label} transcription failed (${resp.status})`);
  err.status = resp.status;
  return err;
}

function abortError() {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

module.exports = {
  CARTESIA_VERSION,
  transcribeWithElevenLabs,
  transcribeWithDeepgram,
  transcribeWithCohere,
  transcribeWithGeminiTranscribe,
  transcribeWithAssemblyAI,
  transcribeWithCorti,
  transcribeWithCartesia,
  pcmFromWav
};
