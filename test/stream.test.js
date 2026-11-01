'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, createAssembler } = require('../lib/stream');

test('normalizeEvent: transcript, final turn, error, done', () => {
  assert.deepEqual(normalizeEvent(JSON.stringify({ type: 'transcript', text: 'hello', is_final: false })),
    { type: 'transcript', text: 'hello', isFinal: false });
  assert.deepEqual(normalizeEvent({ text: 'done turn', final: true }),
    { type: 'transcript', text: 'done turn', isFinal: true });
  assert.deepEqual(normalizeEvent({ type: 'error', error: 'bad key' }),
    { type: 'error', error: 'bad key' });
  assert.deepEqual(normalizeEvent({ type: 'done' }), { type: 'done' });
  assert.deepEqual(normalizeEvent('not json'), { type: 'other' });
  assert.deepEqual(normalizeEvent({ type: 'metadata' }), { type: 'other' });
});

test('assembler: finals accumulate, partial replaces itself', () => {
  const a = createAssembler();
  assert.equal(a.text(), '');
  a.apply({ type: 'transcript', text: 'Hello', isFinal: false });
  assert.equal(a.text(), 'Hello');
  assert.equal(a.finalText(), '');
  a.apply({ type: 'transcript', text: 'Hello world', isFinal: false });
  assert.equal(a.text(), 'Hello world');
  a.apply({ type: 'transcript', text: 'Hello world.', isFinal: true });
  assert.equal(a.finalText(), 'Hello world.');
  a.apply({ type: 'transcript', text: 'Second', isFinal: false });
  assert.equal(a.text(), 'Hello world. Second');
  a.apply({ type: 'transcript', text: 'Second turn.', isFinal: true });
  assert.equal(a.text(), 'Hello world. Second turn.');
  assert.equal(a.partialText(), '');
});

test('assembler: finalize fallback uses the final turns only', () => {
  const a = createAssembler();
  a.apply({ type: 'transcript', text: 'Committed.', isFinal: true });
  a.apply({ type: 'transcript', text: 'trailing partial', isFinal: false });
  assert.equal(a.finalText(), 'Committed.');
  assert.equal(a.text(), 'Committed. trailing partial');
});
