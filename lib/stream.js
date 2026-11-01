'use strict';

// Stable contract between the streaming proxy and the browser. Provider events
// are normalized here so the client never depends on a provider's payload
// shape (and no provider metadata leaks into the page).
function normalizeEvent(raw) {
  let data = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return { type: 'other' }; }
  }
  if (!data || typeof data !== 'object') return { type: 'other' };

  if (data.type === 'error' || data.error) {
    return { type: 'error', error: String(data.error || data.message || 'Streaming provider error') };
  }
  if (data.type === 'done' || data.type === 'final' && !data.text) {
    return { type: 'done' };
  }
  const text = data.text || data.transcript || '';
  if (text) {
    return {
      type: 'transcript',
      text: String(text),
      isFinal: !!(data.is_final || data.final || data.type === 'final')
    };
  }
  return { type: 'other' };
}

// Transcript assembly: completed turns plus the in-flight partial.
function createAssembler() {
  const finals = [];
  let partial = '';
  return {
    apply(event) {
      if (!event || event.type !== 'transcript') return this.text();
      if (event.isFinal) {
        const text = String(event.text || '').trim();
        const joined = finals.join(' ').trim();
        if (text && joined && (text === joined || text.startsWith(joined))) {
          finals.length = 0;
          finals.push(text);
        } else if (text) {
          finals.push(text);
        }
        partial = '';
      } else {
        partial = event.text;
      }
      return this.text();
    },
    text() {
      const joined = finals.join(' ').trim();
      if (!partial) return joined;
      return (joined ? joined + ' ' : '') + partial;
    },
    finalText() { return finals.join(' ').trim(); },
    partialText() { return partial; },
    clear() { finals.length = 0; partial = ''; }
  };
}

module.exports = { normalizeEvent, createAssembler };
