'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const adapters = require('../lib/adapters');

test('language codes are mapped for providers that expect them', () => {
  assert.equal(adapters.elevenLabsLanguage('en'), 'eng');
  assert.equal(adapters.elevenLabsLanguage('eng'), 'eng');
  assert.equal(adapters.elevenLabsLanguage('xx'), '');
  assert.equal(adapters.geminiLanguage('en'), 'en-US');
  assert.equal(adapters.geminiLanguage('en-GB'), 'en-GB');
  assert.equal(adapters.geminiLanguage('xx'), '');
});

function tmpAudio(contents = 'audio-bytes', ext = 'webm') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dictation-adapter-'));
  const file = path.join(dir, `sample.${ext}`);
  fs.writeFileSync(file, contents);
  return file;
}

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

test('ElevenLabs: multipart, xi-api-key header, response text', async () => {
  const audioPath = tmpAudio();
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ text: 'hello world' });
  };
  const text = await adapters.transcribeWithElevenLabs({
    audioPath, mimeType: 'audio/webm', profile: { apiKey: 'xi-123', model: 'scribe_v2' },
    language: 'en', hint: 'Acme, Globex', fetchImpl
  });
  assert.equal(text, 'hello world');
  assert.equal(seen.url, 'https://api.elevenlabs.io/v1/speech-to-text');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['xi-api-key'], 'xi-123');
  assert.ok(seen.init.body instanceof FormData);
  assert.equal(seen.init.body.get('model_id'), 'scribe_v2');
  assert.equal(seen.init.body.get('language_code'), 'eng');
  assert.deepEqual(seen.init.body.getAll('keyterms'), ['Acme', 'Globex']);
});

test('Deepgram: Token auth (not Bearer), raw body, nested transcript', async () => {
  const audioPath = tmpAudio('raw-audio', 'mp3');
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ results: { channels: [{ alternatives: [{ transcript: 'deep text' }] }] } });
  };
  const text = await adapters.transcribeWithDeepgram({
    audioPath, mimeType: 'audio/mpeg', profile: { apiKey: 'dg-1', model: 'nova-3' },
    hint: 'Jira, Scrum', fetchImpl
  });
  assert.equal(text, 'deep text');
  assert.match(seen.url, /^https:\/\/api\.deepgram\.com\/v1\/listen\?/);
  assert.match(seen.url, /model=nova-3/);
  assert.match(seen.url, /keywords=Jira/);
  assert.equal(seen.init.headers.Authorization, 'Token dg-1');
  assert.ok(Buffer.isBuffer(seen.init.body));
});

test('Cohere: Bearer auth, multipart, text field', async () => {
  const audioPath = tmpAudio();
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ text: 'cohere text' });
  };
  const text = await adapters.transcribeWithCohere({
    audioPath, mimeType: 'audio/webm', profile: { apiKey: 'co-1' }, fetchImpl
  });
  assert.equal(text, 'cohere text');
  assert.equal(seen.url, 'https://api.cohere.com/v2/audio/transcriptions');
  assert.equal(seen.init.headers.Authorization, 'Bearer co-1');
  assert.ok(seen.init.body instanceof FormData);
});

test('one-call adapters throw on non-2xx', async () => {
  const audioPath = tmpAudio();
  const fetchImpl = async () => jsonResponse({ error: 'nope' }, 401);
  await assert.rejects(
    adapters.transcribeWithElevenLabs({ audioPath, mimeType: 'audio/webm', profile: { apiKey: 'x' }, fetchImpl }),
    /ElevenLabs transcription failed \(401\)/
  );
});

test('AssemblyAI: upload, create, poll until completed', async () => {
  const audioPath = tmpAudio();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/v2/upload')) return jsonResponse({ upload_url: 'https://cdn/audio' });
    if (url.endsWith('/v2/transcript')) return jsonResponse({ id: 'job-1' });
    if (url.endsWith('/v2/transcript/job-1')) {
      const polls = calls.filter(c => c.url.includes('job-1')).length;
      if (polls < 3) return jsonResponse({ status: 'processing' });
      return jsonResponse({ status: 'completed', text: 'assembled text' });
    }
    throw new Error('unexpected ' + url);
  };
  const text = await adapters.transcribeWithAssemblyAI({
    audioPath, mimeType: 'audio/webm', profile: { apiKey: 'aa-1' }, fetchImpl,
    pollIntervalMs: 1, timeoutMs: 5000
  });
  assert.equal(text, 'assembled text');
  assert.equal(calls[0].init.headers.authorization, 'aa-1');
  const create = JSON.parse(calls[1].init.body);
  assert.equal(create.audio_url, 'https://cdn/audio');
});

test('AssemblyAI: an error status stops polling and throws', async () => {
  const audioPath = tmpAudio();
  const fetchImpl = async (url) => {
    if (url.endsWith('/v2/upload')) return jsonResponse({ upload_url: 'https://cdn/audio' });
    if (url.endsWith('/v2/transcript')) return jsonResponse({ id: 'job-2' });
    return jsonResponse({ status: 'error', error: 'bad audio' });
  };
  await assert.rejects(
    adapters.transcribeWithAssemblyAI({
      audioPath, mimeType: 'audio/webm', profile: { apiKey: 'k' }, fetchImpl,
      pollIntervalMs: 1, timeoutMs: 5000
    }),
    /bad audio/
  );
});

test('Gemini Transcribe: native generateContent with inline audio', async () => {
  const audioPath = tmpAudio('wav-bytes', 'wav');
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ candidates: [{ content: { parts: [{ text: 'native gemini text' }] } }] });
  };
  const text = await adapters.transcribeWithGeminiTranscribe({
    audioPath, mimeType: 'audio/wav',
    profile: { apiKey: 'AIza-test', model: 'gemini-3.5-transcribe', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
    language: 'en', hint: 'Acme, Jira', fetchImpl
  });
  assert.equal(text, 'native gemini text');
  assert.equal(seen.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-transcribe:generateContent');
  assert.equal(seen.init.headers['x-goog-api-key'], 'AIza-test');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.contents[0].parts[0].inline_data.mime_type, 'audio/wav');
  assert.ok(body.contents[0].parts[0].inline_data.data);
  assert.deepEqual(body.generation_config.audio_transcription_config.languageCodes, ['en-US']);
  assert.deepEqual(body.generation_config.audio_transcription_config.customVocabulary, ['Acme', 'Jira']);
});

test('Gemini Transcribe: reads audioTranscription text and tolerates an empty response', async () => {
  const audioPath = tmpAudio('wav-bytes', 'wav');
  const profile = { apiKey: 'k', model: 'gemini-3.5-transcribe', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
  const viaParts = await adapters.transcribeWithGeminiTranscribe({
    audioPath, mimeType: 'audio/wav', profile,
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [{ audioTranscription: { text: 'from audio transcription' } }] } }] })
  });
  assert.equal(viaParts, 'from audio transcription');

  const empty = await adapters.transcribeWithGeminiTranscribe({
    audioPath, mimeType: 'audio/wav', profile,
    fetchImpl: async () => jsonResponse({ candidates: [{ finishReason: 'STOP', content: { parts: [] } }] })
  });
  assert.equal(empty, '');
});

test('provider errors include the response body', async () => {
  const audioPath = tmpAudio();
  const fetchImpl = async () => ({ ok: false, status: 400, text: async () => '{"detail":{"message":"bad keyterms"}}' });
  await assert.rejects(
    adapters.transcribeWithElevenLabs({ audioPath, mimeType: 'audio/webm', profile: { apiKey: 'x' }, fetchImpl }),
    /bad keyterms/
  );
});

test('pcmFromWav strips header and returns s16le payload', () => {
  const wav = Buffer.alloc(44 + 8);
  wav.write('RIFF', 0); wav.write('WAVE', 8); wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16); wav.write('data', 36); wav.writeUInt32LE(8, 40);
  wav.writeInt16LE(1234, 44);
  const pcm = adapters.pcmFromWav(wav);
  assert.equal(pcm.length, 8);
  assert.equal(pcm.readInt16LE(0), 1234);
  assert.throws(() => adapters.pcmFromWav(Buffer.from('not a wav')), /WAV/);
});

test('Cartesia: handshake params, header, frames, one finalize, final text', async () => {
  class FakeWebSocket {
    constructor(url, options) {
      FakeWebSocket.last = this;
      this.url = url;
      this.options = options;
      this.sent = [];
      this.listeners = {};
      this.closed = false;
    }
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
    emit(type, event) { (this.listeners[type] || []).forEach(fn => fn(event)); }
    send(data) { this.sent.push(data); }
    close() { this.closed = true; }
  }

  const audioPath = tmpAudio('ignored');
  const pcm = Buffer.alloc(7000, 1);
  const promise = adapters.transcribeWithCartesia({
    audioPath, profile: { apiKey: 'cart-key', model: 'ink-2' }, pcm,
    WebSocketImpl: FakeWebSocket, timeoutMs: 5000
  });
  const ws = FakeWebSocket.last;
  assert.match(ws.url, /^wss:\/\/api\.cartesia\.ai\/stt\/websocket\?/);
  assert.match(ws.url, /model=ink-2/);
  assert.match(ws.url, /encoding=pcm_s16le/);
  assert.match(ws.url, /sample_rate=16000/);
  assert.match(ws.url, /cartesia_version=2026-03-01/);
  assert.equal(ws.options.headers['X-API-Key'], 'cart-key');

  ws.emit('open', {});
  const finalizes = ws.sent.filter(item => typeof item === 'string' && JSON.parse(item).type === 'finalize');
  assert.equal(finalizes.length, 1);
  assert.ok(ws.sent.some(item => Buffer.isBuffer(item)));

  ws.emit('message', { data: JSON.stringify({ type: 'transcript', text: 'hello', is_final: true }) });
  assert.equal(await promise, 'hello');
});

test('batch fallback: a live ElevenLabs profile sends the batch model', async () => {
  const providers = require('../lib/providers');
  const resolved = providers.resolveProfile({
    id: 'live', provider: 'elevenlabs_stream', model: 'scribe_v2_realtime', apiKey: 'xi-123'
  });
  const batch = providers.resolveBatchProfile(resolved);
  const audioPath = tmpAudio();
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return jsonResponse({ text: 'recorded file text' });
  };
  const text = await adapters.transcribeWithElevenLabs({
    audioPath, mimeType: 'audio/webm', profile: batch, fetchImpl
  });
  assert.equal(text, 'recorded file text');
  assert.equal(seen.init.body.get('model_id'), 'scribe_v2');
  assert.notEqual(seen.init.body.get('model_id'), 'scribe_v2_realtime');
});
