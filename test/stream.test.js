'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, createAssembler } = require('../lib/stream');

test('normalizeEvent: Cartesia turn events', () => {
  assert.deepEqual(normalizeEvent({ type: 'turn.start' }), { type: 'turn-start' });
  assert.deepEqual(normalizeEvent({ type: 'turn.update', transcript: 'Hello' }),
    { type: 'transcript', text: 'Hello', isFinal: false });
  assert.deepEqual(normalizeEvent({ type: 'turn.eager_end', transcript: 'Hello.' }),
    { type: 'transcript', text: 'Hello.', isFinal: false });
  assert.deepEqual(normalizeEvent({ type: 'turn.end', transcript: 'Hello world.' }),
    { type: 'transcript', text: 'Hello world.', isFinal: true });
  assert.deepEqual(normalizeEvent({ type: 'turn.resume' }), { type: 'turn-resume' });
});

test('normalizeEvent: manual/legacy shape, error, done, junk', () => {
  assert.deepEqual(normalizeEvent(JSON.stringify({ type: 'transcript', text: 'hi', is_final: false })),
    { type: 'transcript', text: 'hi', isFinal: false });
  assert.deepEqual(normalizeEvent({ text: 'done turn', final: true }),
    { type: 'transcript', text: 'done turn', isFinal: true });
  assert.deepEqual(normalizeEvent({ type: 'error', error: 'bad key' }),
    { type: 'error', error: 'bad key' });
  assert.deepEqual(normalizeEvent({ type: 'done' }), { type: 'done' });
  assert.deepEqual(normalizeEvent('not json'), { type: 'other' });
  assert.deepEqual(normalizeEvent({ type: 'metadata' }), { type: 'other' });
});

test('assembler: finals concatenate without invented spaces, partial replaces', () => {
  const a = createAssembler();
  assert.equal(a.text(), '');
  a.apply({ type: 'turn-start' });
  a.apply({ type: 'transcript', text: 'Hello', isFinal: false });
  assert.equal(a.text(), 'Hello');
  a.apply({ type: 'transcript', text: 'Hello world', isFinal: false });
  assert.equal(a.text(), 'Hello world');
  a.apply({ type: 'transcript', text: 'Hello world.', isFinal: true });
  assert.equal(a.text(), 'Hello world.');
  // Ink includes its own spacing; no space is injected between turns.
  a.apply({ type: 'transcript', text: ' Second turn.', isFinal: true });
  assert.equal(a.text(), 'Hello world. Second turn.');
  a.apply({ type: 'turn-start' });
  a.apply({ type: 'transcript', text: 'partial', isFinal: false });
  assert.equal(a.text(), 'Hello world. Second turn.partial');
  assert.equal(a.finalText(), 'Hello world. Second turn.');
});
