'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEvent, createAssembler, createNormalizer, createPcmResampler } = require('../lib/stream');

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

test('AssemblyAI: partials replace, finals append with a separator, turn_order dedup', () => {
  const n = createNormalizer('assemblyai-stream');
  assert.deepEqual(n.normalize({ type: 'Begin' }), { type: 'turn-start' });
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 0, turn_is_formatted: false, end_of_turn: false, transcript: 'My name is' }),
    { type: 'transcript', text: 'My name is', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 0, turn_is_formatted: false, end_of_turn: true, transcript: 'my name is sonny' }),
    { type: 'transcript', text: 'my name is sonny', isFinal: true }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 0, turn_is_formatted: false, end_of_turn: true, transcript: 'my name is sonny' }),
    { type: 'other' }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 1, turn_is_formatted: false, end_of_turn: false, transcript: 'how are you' }),
    { type: 'transcript', text: ' how are you', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 1, turn_is_formatted: false, end_of_turn: true, transcript: 'how are you?' }),
    { type: 'transcript', text: ' how are you?', isFinal: true }
  );
  assert.deepEqual(n.normalize({ type: 'Termination' }), { type: 'done' });
});

test('AssemblyAI: format_turns double-final keeps the formatted turn once', () => {
  const n = createNormalizer('assemblyai-stream', { formatTurns: true });
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 3, turn_is_formatted: false, end_of_turn: true, transcript: 'my name is sonny' }),
    { type: 'other' }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 3, turn_is_formatted: true, end_of_turn: true, transcript: 'My name is Sonny.' }),
    { type: 'transcript', text: 'My name is Sonny.', isFinal: true }
  );
  assert.deepEqual(
    n.normalize({ type: 'Turn', turn_order: 3, turn_is_formatted: true, end_of_turn: true, transcript: 'My name is Sonny.' }),
    { type: 'other' }
  );
  assert.deepEqual(n.flush(), { type: 'other' });
});

test('AssemblyAI: flush emits a held unformatted final', () => {
  const n = createNormalizer('assemblyai-stream', { formatTurns: true });
  n.normalize({ type: 'Turn', turn_order: 4, turn_is_formatted: false, end_of_turn: true, transcript: 'held' });
  assert.deepEqual(n.flush(), { type: 'transcript', text: 'held', isFinal: true });
});

test('ElevenLabs: partial replaces, committed segments append', () => {
  const n = createNormalizer('elevenlabs-stream');
  assert.deepEqual(n.normalize({ message_type: 'session_started' }), { type: 'other' });
  assert.deepEqual(
    n.normalize({ message_type: 'partial_transcript', text: 'Hello' }),
    { type: 'transcript', text: 'Hello', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ message_type: 'committed_transcript', text: 'hello.' }),
    { type: 'transcript', text: 'hello.', isFinal: true }
  );
  assert.deepEqual(
    n.normalize({ message_type: 'partial_transcript', text: 'How' }),
    { type: 'transcript', text: ' How', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ message_type: 'committed_transcript', text: 'how are you?' }),
    { type: 'transcript', text: ' how are you?', isFinal: true }
  );
  assert.deepEqual(
    n.normalize({ message_type: 'auth_error', error: 'bad key' }),
    { type: 'error', error: 'bad key' }
  );
});

test('Mistral: deltas are additive, done is the single final', () => {
  const n = createNormalizer('mistral-stream');
  assert.deepEqual(n.normalize({ type: 'session.created' }), { type: 'other' });
  assert.deepEqual(
    n.normalize({ type: 'transcription.text.delta', text: ' for' }),
    { type: 'transcript', text: ' for', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ type: 'transcription.text.delta', text: ' sure' }),
    { type: 'transcript', text: ' for sure', isFinal: false }
  );
  assert.deepEqual(
    n.normalize({ type: 'transcription.done', text: ' for sure.' }),
    { type: 'transcript', text: ' for sure.', isFinal: true }
  );
  assert.deepEqual(
    n.normalize({ type: 'error', error: { message: 'bad audio', code: 1 } }),
    { type: 'error', error: 'bad audio' }
  );
});

test('PCM resampler: 16k to 24k is continuous and block-stable', () => {
  const oneShot = createPcmResampler(16000, 24000);
  const samples = new Int16Array(1600);
  for (let i = 0; i < samples.length; i++) samples[i] = i;
  const raw = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) raw.writeInt16LE(samples[i], i * 2);

  const single = oneShot.process(raw);
  assert.ok(single.length / 2 >= 2390, 'emits about 1.5x the samples');

  const split = createPcmResampler(16000, 24000);
  const a = split.process(raw.subarray(0, 1600));
  const b = split.process(raw.subarray(1600));
  const joined = Buffer.concat([a, b]);
  assert.deepEqual(joined.subarray(0, Math.min(joined.length, 4000)), single.subarray(0, Math.min(joined.length, 4000)));

  const same = createPcmResampler(16000, 16000);
  assert.deepEqual(same.process(raw), raw);
});
