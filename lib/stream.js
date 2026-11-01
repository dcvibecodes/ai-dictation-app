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

// Transcript assembly: completed turns plus the in-flight partial. Ink does not
// insert spaces between turn transcripts, so neither do we.
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

module.exports = { normalizeEvent, createAssembler };
