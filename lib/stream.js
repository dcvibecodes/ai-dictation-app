'use strict';

// Stable contract between the streaming proxy and the browser. Provider events
// are normalized here so the client never depends on a provider's payload
// shape (and no provider metadata leaks into the page).
//
// Cartesia's auto-finalization endpoint (/stt/turns/websocket) emits turn
// events with a `transcript` field:
//   turn.start, turn.update, turn.eager_end, turn.resume, turn.end
// Ink transcripts are not space-joined, so finals are concatenated as-is.
function normalizeEvent(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return { type: 'other' }; }
  }
  if (!data || typeof data !== 'object') return { type: 'other' };

  if (data.type === 'error' || data.error) {
    return { type: 'error', error: String(data.error || data.message || 'Streaming provider error') };
  }

  const type = data.type;
  if (type === 'turn.start') return { type: 'turn-start' };
  if (type === 'turn.resume') return { type: 'turn-resume' };
  if (type === 'turn.update' || type === 'turn.eager_end') {
    return { type: 'transcript', text: String(data.transcript || data.text || ''), isFinal: false };
  }
  if (type === 'turn.end') {
    return { type: 'transcript', text: String(data.transcript || data.text || ''), isFinal: true };
  }
  if (type === 'done') return { type: 'done' };

  // Manual-finalization event shape (is_final: true deltas) kept for the
  // file adapter and future providers.
  const text = data.text || data.transcript || '';
  if (text) {
    return {
      type: 'transcript',
      text: String(text),
      isFinal: !!(data.is_final || data.final || type === 'final')
    };
  }
  return { type: 'other' };
}

function parsePayload(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  return data && typeof data === 'object' ? data : null;
}

function providerError(data) {
  const value = data && (data.error || data.message);
  let message = 'Streaming provider error';
  if (typeof value === 'string') message = value;
  else if (value && typeof value.message === 'string') message = value.message;
  return { type: 'error', error: String(message).slice(0, 300) };
}

// Ink needs no separator. The other providers return per-segment finals, so add
// one space between segments unless punctuation or existing whitespace covers
// it. Interims inherit the same prefix so the preview never shows "HelloHow".
function needsSpace(previous, next) {
  if (!previous || !next) return false;
  if (/\s$/.test(previous) || /^\s/.test(next)) return false;
  if (/^[.,!?;:%)\]}]/.test(next)) return false;
  return true;
}

function createAssemblyAINormalizer({ formatTurns = false } = {}) {
  const finalized = new Set();
  let finalText = '';
  let pending = null;

  const withPrefix = text => (needsSpace(finalText, text) ? ' ' + text : text);

  const emitFinal = (text) => {
    const rendered = withPrefix(text);
    finalText += rendered;
    return { type: 'transcript', text: rendered, isFinal: true };
  };

  return {
    normalize(raw) {
      const data = parsePayload(raw);
      if (!data) return { type: 'other' };
      if (data.type === 'Error' || data.error) return providerError(data);
      if (data.type === 'Begin') return { type: 'turn-start' };
      if (data.type === 'Termination') return { type: 'done' };
      if (data.type !== 'Turn') return { type: 'other' };

      const order = Number(data.turn_order);
      const text = String(data.transcript || '');
      const formatted = data.turn_is_formatted === true;

      if (data.end_of_turn !== true) {
        if (pending) return { type: 'other' };
        return { type: 'transcript', text: withPrefix(text), isFinal: false };
      }

      // A turn is final on end_of_turn. Dedup by turn_order so neither the
      // formatted/unformatted pair nor a repeated message can emit twice.
      if (Number.isFinite(order) && finalized.has(order)) return { type: 'other' };
      if (formatTurns && !formatted) {
        // With format_turns on, the formatted final follows the unformatted
        // one. Hold it until the better copy arrives.
        pending = { order, text };
        return { type: 'other' };
      }
      if (Number.isFinite(order)) finalized.add(order);
      pending = null;
      return emitFinal(text);
    },
    flush() {
      if (!pending) return { type: 'other' };
      const { order, text } = pending;
      pending = null;
      if (Number.isFinite(order)) finalized.add(order);
      return emitFinal(text);
    }
  };
}

function createElevenLabsNormalizer() {
  let finalText = '';
  const withPrefix = text => (needsSpace(finalText, text) ? ' ' + text : text);
  return {
    normalize(raw) {
      const data = parsePayload(raw);
      if (!data) return { type: 'other' };
      const type = data.message_type || data.type;
      if (data.error || /error|quota|throttled|exhausted|rate_limited|overflow|unaccepted/.test(String(type))) {
        return providerError(data);
      }
      if (type === 'partial_transcript') {
        return { type: 'transcript', text: withPrefix(String(data.text || '')), isFinal: false };
      }
      if (type === 'committed_transcript' || type === 'committed_transcript_with_timestamps') {
        const text = String(data.text || '');
        const rendered = withPrefix(text);
        finalText += rendered;
        return { type: 'transcript', text: rendered, isFinal: true };
      }
      return { type: 'other' };
    },
    flush() { return { type: 'other' }; }
  };
}

function createGeminiLiveNormalizer() {
  let finalText = '';
  const withPrefix = text => (needsSpace(finalText, text) ? ' ' + text : text);
  return {
    normalize(raw) {
      const data = parsePayload(raw);
      if (!data) return { type: 'other' };
      if (data.error) return providerError(data);
      const content = data.serverContent;
      if (!content) return { type: 'other' };
      if (content.interimInputTranscription) {
        return {
          type: 'transcript',
          text: withPrefix(String(content.interimInputTranscription.text || '')),
          isFinal: false
        };
      }
      if (content.inputTranscription) {
        const text = String(content.inputTranscription.text || '');
        const rendered = withPrefix(text);
        finalText += rendered;
        return { type: 'transcript', text: rendered, isFinal: true };
      }
      return { type: 'other' };
    },
    flush() { return { type: 'other' }; }
  };
}

function createMistralNormalizer() {
  let partial = '';
  return {
    normalize(raw) {
      const data = parsePayload(raw);
      if (!data) return { type: 'other' };
      if (data.type === 'error') return providerError(data);
      if (data.type === 'transcription.text.delta') {
        // Deltas are additive and carry their own spacing; append verbatim.
        partial += String(data.text || '');
        return { type: 'transcript', text: partial, isFinal: false };
      }
      if (data.type === 'transcription.done') {
        const full = String(data.text || partial || '');
        partial = '';
        return { type: 'transcript', text: full, isFinal: true };
      }
      return { type: 'other' };
    },
    flush() { return { type: 'other' }; }
  };
}

function createNormalizer(protocol, options = {}) {
  if (protocol === 'assemblyai-stream') return createAssemblyAINormalizer(options);
  if (protocol === 'elevenlabs-stream') return createElevenLabsNormalizer();
  if (protocol === 'mistral-stream') return createMistralNormalizer();
  if (protocol === 'gemini-transcribe-live') return createGeminiLiveNormalizer();
  return {
    normalize: normalizeEvent,
    flush: () => ({ type: 'other' })
  };
}

// Transcript assembly: completed turns plus the in-flight partial. Providers
// supply their own separators (Mistral) or the normalizer adds the missing
// space between segment finals (AssemblyAI/ElevenLabs), so no separator is
// injected here — Ink specifically must stay byte-identical.
function createAssembler() {
  let finalText = '';
  let partial = '';
  return {
    apply(event) {
      if (!event) return this.text();
      if (event.type === 'turn-start') {
        partial = '';
      } else if (event.type === 'transcript') {
        if (event.isFinal) {
          finalText += String(event.text || '');
          partial = '';
        } else {
          partial = String(event.text || '');
        }
      }
      return this.text();
    },
    text() { return finalText + partial; },
    finalText() { return finalText; },
    partialText() { return partial; },
    clear() { finalText = ''; partial = ''; }
  };
}

// Continuous 16-bit little-endian mono PCM resampler. Used to turn the app's
// 16 kHz capture into the 24 kHz stream Mistral documents, without depending on
// a native audio library. Output is block-stable: interpolation carries across
// chunk boundaries, so no samples are repeated or dropped at frame edges.
function createPcmResampler(fromRate, toRate) {
  if (fromRate === toRate) {
    return {
      process(chunk) { return Buffer.from(chunk); },
      flush() { return Buffer.alloc(0); }
    };
  }
  const step = fromRate / toRate;
  let nextPos = 0;      // fractional input-sample index of the next output
  let inputStart = 0;   // absolute index of the first sample in this chunk
  let previous = null;  // last sample of the previous chunk
  let leftover = Buffer.alloc(0);

  function process(chunk) {
    if (!chunk || !chunk.length) return Buffer.alloc(0);
    let data = chunk;
    if (leftover.length) data = Buffer.concat([leftover, chunk]);
    const usable = data.length - (data.length % 2);
    leftover = usable === data.length ? Buffer.alloc(0) : data.subarray(usable);
    const count = usable / 2;
    if (!count) return Buffer.alloc(0);

    const samples = new Int16Array(count);
    for (let i = 0; i < count; i++) samples[i] = data.readInt16LE(i * 2);
    const start = inputStart;
    inputStart += count;

    const output = [];
    while (true) {
      const pos = nextPos;
      const i0 = Math.floor(pos);
      const frac = pos - i0;

      if (frac === 0) {
        if (i0 < start - 1 || i0 > start + count - 1) break;
        output.push(i0 === start - 1 ? previous : samples[i0 - start]);
      } else {
        if (i0 < start - 1 || i0 + 1 > start + count - 1) break;
        const s0 = i0 === start - 1 ? previous : samples[i0 - start];
        const s1 = samples[i0 + 1 - start];
        output.push(Math.round(s0 * (1 - frac) + s1 * frac));
      }

      nextPos += step;
      if (output.length > 100000) break;
    }

    previous = samples[count - 1];
    const out = Buffer.alloc(output.length * 2);
    for (let i = 0; i < output.length; i++) {
      out.writeInt16LE(Math.max(-32768, Math.min(32767, output[i])), i * 2);
    }
    return out;
  }

  return {
    process,
    flush() { return Buffer.alloc(0); }
  };
}

module.exports = {
  normalizeEvent,
  createNormalizer,
  createAssembler,
  createPcmResampler
};
