'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AudioLedger,
  MemoryAdapter,
  StreamingResampler,
  float32FromPcm16,
  loadSessionAudio
} = require('../public/lib/audio-ledger.js');

function ramp(n, start = 0) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((start + i) * 0.01) * 0.8;
  return out;
}

function feedResampler(resampler, input, chunkSizes) {
  const parts = [];
  let offset = 0;
  let ci = 0;
  while (offset < input.length) {
    const size = Math.min(chunkSizes[ci % chunkSizes.length], input.length - offset);
    const { samples } = resampler.process(input.subarray(offset, offset + size));
    parts.push(samples);
    offset += size;
    ci++;
  }
  parts.push(resampler.flush().samples);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

test('resampler output is identical across chunk boundaries', () => {
  const input = ramp(48000);
  const whole = feedResampler(new StreamingResampler(48000, 16000), input, [48000]);
  for (const sizes of [[400], [4096], [137, 800, 4000], [1]]) {
    const chunked = feedResampler(new StreamingResampler(48000, 16000), input, sizes);
    assert.equal(chunked.length, whole.length, 'length for chunks ' + sizes);
    for (let i = 0; i < whole.length; i++) {
      assert.ok(Math.abs(chunked[i] - whole[i]) < 1e-7, `sample ${i} differs for chunks ${sizes}`);
    }
  }
});

test('resampler at equal rates preserves every sample', () => {
  const input = ramp(1000);
  const out = feedResampler(new StreamingResampler(16000, 16000), input, [37]);
  assert.equal(out.length, input.length);
  for (let i = 0; i < input.length; i++) assert.equal(out[i], input[i]);
});

test('ledger captures every sample exactly once across many callbacks', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's1', adapter });
  const input = ramp(16000);
  // 40 callbacks of 400 samples, like the old synthetic reproduction.
  for (let i = 0; i < 40; i++) {
    await ledger.append(input.subarray(i * 400, (i + 1) * 400), i * 400);
  }
  await ledger.flush();
  const cov = await ledger.coverage();
  assert.equal(cov.capturedSamples, 16000);
  assert.equal(cov.flushedSamples, 16000);
  assert.equal(cov.persistedSamples, 16000);
  assert.equal(cov.gaps, 0);
  assert.equal(cov.overlaps, 0);

  const blocks = await adapter.getBlocks('s1');
  let total = 0;
  for (const b of blocks) total += b.pcm.length;
  assert.equal(total, 16000);

  // Reconstructed audio keeps the source samples (PCM16 rounding only).
  const { blob, totalSamples } = await ledger.buildWav();
  assert.equal(totalSamples, 16000);
  assert.equal(blob.type, 'audio/wav');
  const recovered = float32FromPcm16(new Int16Array(await blob.arrayBuffer(), 44));
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(recovered[i] - input[i]) < 1e-4, 'sample ' + i);
  }
});

test('ledger keeps working after an independent send cursor advances', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's2', adapter });
  const input = ramp(20000);
  let sendCursor = 0;
  for (let i = 0; i < 50; i++) {
    await ledger.append(input.subarray(i * 400, (i + 1) * 400), i * 400);
    if (i % 10 === 9) sendCursor = (i + 1) * 400; // send consumes a chunk
  }
  await ledger.flush();
  const cov = await ledger.coverage();
  assert.equal(cov.capturedSamples, 20000);
  assert.equal(cov.flushedSamples, 20000);
  assert.equal(sendCursor, 20000);
});

test('ledger detects and reports gaps and overlaps instead of hiding them', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's3', adapter });
  await ledger.append(ramp(400), 0);
  await ledger.append(ramp(400), 500);   // 100-sample gap
  await ledger.append(ramp(400), 700);   // 200-sample overlap
  await ledger.flush();
  const cov = await ledger.coverage();
  assert.equal(cov.gaps, 100);
  assert.equal(cov.overlaps, 200);
});

test('storage failure keeps audio in memory and is reported honestly', async () => {
  const adapter = new MemoryAdapter();
  adapter.putBlock = async () => { throw new Error('quota exceeded'); };
  const ledger = new AudioLedger({ sessionId: 's4', adapter });
  await ledger.append(ramp(8000), 0);
  await ledger.flush();
  const cov = await ledger.coverage();
  assert.equal(cov.storageFailed, true);
  assert.match(cov.storageError, /quota/);
  assert.equal(cov.persistedSamples, 0);
  const { totalSamples } = await ledger.buildWav();
  assert.equal(totalSamples, 8000);
});

test('recovery reads a completed session from storage', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's5', adapter });
  await ledger.append(ramp(5000), 0);
  await ledger.flush();
  const recovered = await loadSessionAudio(adapter, 's5');
  assert.equal(recovered.totalSamples, 5000);
  assert.equal(recovered.session.complete, true);
  assert.equal(recovered.blocks.length, 2); // 4000 + 1000 at the default 250 ms block
});

test('flushPending persists a sub-block tail and stays unfinished', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's7', adapter });
  await ledger.append(ramp(1234), 0);
  await ledger.flushPending();
  const cov = await ledger.coverage();
  assert.equal(cov.flushedSamples, 1234);
  assert.equal(cov.persistedSamples, 1234);
  const recovered = await loadSessionAudio(adapter, 's7');
  assert.equal(recovered.totalSamples, 1234);
  assert.equal(recovered.session.complete, false);
  assert.equal(recovered.session.partial, undefined);
});

test('sessions stay isolated in shared storage', async () => {
  const adapter = new MemoryAdapter();
  const a = new AudioLedger({ sessionId: 'a', adapter });
  const b = new AudioLedger({ sessionId: 'b', adapter });
  await a.append(ramp(4000), 0);
  await b.append(ramp(1000), 0);
  await Promise.all([a.flush(), b.flush()]);
  const blocksA = await adapter.getBlocks('a');
  const blocksB = await adapter.getBlocks('b');
  assert.equal(blocksA.reduce((n, x) => n + x.pcm.length, 0), 4000);
  assert.equal(blocksB.reduce((n, x) => n + x.pcm.length, 0), 1000);
  assert.equal((await adapter.getSession('a')).totalSamples, 4000);
  assert.equal((await adapter.getSession('b')).totalSamples, 1000);
});

test('discard removes the session and its blocks', async () => {
  const adapter = new MemoryAdapter();
  const ledger = new AudioLedger({ sessionId: 's6', adapter });
  await ledger.append(ramp(2000), 0);
  await ledger.flush();
  await ledger.discard();
  assert.equal((await adapter.getBlocks('s6')).length, 0);
  assert.equal(await adapter.getSession('s6'), null);
});
