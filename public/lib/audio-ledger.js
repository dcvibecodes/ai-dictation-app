// Audio ledger: records every captured sample exactly once, independent of when
// (or whether) that audio is sent for transcription.
//
// The old live code used the transcription send cursor as the backup cursor. That
// meant audio captured between sends was either skipped or appended twice, and a
// 15-minute RAM cap silently dropped the oldest audio. This module keeps three
// independent things:
//   1. capture    — the caller appends each captured range here, once.
//   2. persistence — blocks are written to storage as they fill.
//   3. sending    — transcription reads the same audio but never mutates the ledger.
//
// The same file is loaded in the browser (window.AudioLedgerLib) and used by the
// Node tests (module.exports).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AudioLedgerLib = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_SAMPLE_RATE = 16000;
  const DEFAULT_BLOCK_SECONDS = 0.25;

  function clampSample(v) {
    return v < -1 ? -1 : v > 1 ? 1 : v;
  }

  function pcm16FromFloat32(samples) {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = clampSample(samples[i]);
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  function float32FromPcm16(pcm) {
    const out = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
    return out;
  }

  // Resample a stream of source samples to `toRate` while keeping absolute output
  // positions stable across chunks. Feeding the same audio in different chunk
  // sizes produces identical output, which is what makes the ledger's "every
  // sample exactly once" guarantee possible.
  //
  // `sourceStart` is the absolute source-sample index of samples[0].
  class StreamingResampler {
    constructor(fromRate, toRate, sourceStart = 0) {
      if (!(fromRate > 0) || !(toRate > 0)) throw new Error('invalid sample rate');
      this.fromRate = fromRate;
      this.toRate = toRate;
      this.ratio = toRate / fromRate;
      this.nextOut = 0;              // next absolute output sample to emit
      this.sourceStart = sourceStart;
      this.carry = 0;                // final source sample of the previous chunk
      this.hasCarry = false;
      this.lastSource = 0;           // final source sample of the whole stream
      this.hasSource = false;
    }

    // Emit every output sample whose interpolation inputs are available. Output
    // positions are global (outIndex / ratio), so chunking cannot shift them.
    // A sample whose interpolation would need the next chunk's first sample is
    // deferred; the carry sample makes that possible on the next call.
    process(samples) {
      const S = this.sourceStart;
      const endExclusive = S + samples.length;
      if (!samples.length) return { samples: new Float32Array(0), outStart: this.nextOut };
      const outStart = this.nextOut;
      const out = [];
      while (true) {
        const p = this.nextOut / this.ratio;
        if (p < S - 1) { this.nextOut++; continue; } // defensive
        if (p > endExclusive - 1) break;            // needs next chunk (or done)
        const i0 = Math.floor(p);
        const frac = p - i0;
        let a;
        let b;
        if (i0 < S) {
          // Only possible for the one deferred sample between chunks.
          a = this.hasCarry ? this.carry : samples[0];
          b = samples[0];
        } else {
          a = samples[i0 - S];
          b = i0 + 1 <= endExclusive - 1 ? samples[i0 + 1 - S] : a;
        }
        out.push(a * (1 - frac) + b * frac);
        this.nextOut++;
      }
      this.lastSource = samples[samples.length - 1];
      this.hasSource = true;
      this.carry = this.lastSource;
      this.hasCarry = true;
      this.sourceStart = endExclusive;
      return { samples: Float32Array.from(out), outStart };
    }

    // Emit the remaining output samples (clamped to the final source sample).
    flush() {
      if (!this.hasSource) return { samples: new Float32Array(0), outStart: this.nextOut };
      const outStart = this.nextOut;
      const totalSource = this.sourceStart;
      const out = [];
      while (this.nextOut / this.ratio < totalSource) {
        out.push(this.lastSource);
        this.nextOut++;
      }
      return { samples: Float32Array.from(out), outStart };
    }
  }

  // In-memory adapter with the same contract as the IndexedDB adapter in
  // script.js. Used by tests and as a fallback when storage is unavailable.
  class MemoryAdapter {
    constructor() {
      this.blocks = new Map();
      this.sessions = new Map();
    }
    async putBlock(block) { this.blocks.set(block.id, block); }
    async getBlocks(sessionId) {
      return [...this.blocks.values()]
        .filter(b => b.sessionId === sessionId)
        .sort((a, b) => a.seq - b.seq);
    }
    async putSession(session) { this.sessions.set(session.id, session); }
    async getSession(id) { return this.sessions.get(id) || null; }
    async getSessions() { return [...this.sessions.values()]; }
    async deleteSession(id) {
      for (const [key, block] of [...this.blocks.entries()]) {
        if (block.sessionId === id) this.blocks.delete(key);
      }
      this.sessions.delete(id);
    }
  }

  function wavFromPcm16Blocks(blocks, sampleRate) {
    const ordered = [...blocks].sort((a, b) => a.startSample - b.startSample);
    let total = 0;
    for (const b of ordered) total += b.pcm.length;
    const buffer = new ArrayBuffer(44 + total * 2);
    const view = new DataView(buffer);
    const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + total * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, total * 2, true);
    let offset = 44;
    for (const b of ordered) {
      for (let i = 0; i < b.pcm.length; i++) {
        view.setInt16(offset, b.pcm[i], true);
        offset += 2;
      }
    }
    return { buffer, totalSamples: total };
  }

  class AudioLedger {
    constructor(options) {
      const opts = options || {};
      if (!opts.sessionId) throw new Error('sessionId required');
      this.sessionId = opts.sessionId;
      this.adapter = opts.adapter;
      this.sampleRate = opts.sampleRate || DEFAULT_SAMPLE_RATE;
      this.blockSamples = opts.blockSamples || this.sampleRate * DEFAULT_BLOCK_SECONDS;
      this.session = {
        id: this.sessionId,
        startedAt: opts.startedAt || Date.now(),
        updatedAt: Date.now(),
        sampleRate: this.sampleRate,
        totalSamples: 0,
        flushedSamples: 0,
        persistedSamples: 0,
        blockCount: 0,
        complete: false,
        storageFailed: false,
        gaps: 0,
        overlaps: 0
      };
      this.nextSample = 0;
      this.pending = new Float32Array(this.blockSamples);
      this.pendingLength = 0;
      this.blockSeq = 0;
      this.memoryBlocks = new Map(); // blocks not yet acknowledged by storage
      this.writeChain = Promise.resolve();
      this.discarded = false;
      this.issues = [];
      this.lastManifestAt = 0;
    }

    // Append a contiguous range of 16 kHz samples. `startSample` is the absolute
    // output position; it can be used to detect a missing or duplicated range.
    async append(samples, startSample) {
      if (this.discarded) return;
      if (!samples || !samples.length) return;
      let start = startSample === undefined ? this.nextSample : startSample;
      if (start > this.nextSample) {
        const gap = start - this.nextSample;
        this.issues.push({ type: 'gap', at: this.nextSample, samples: gap });
        this.session.gaps += gap;
        this.nextSample = start; // keep absolute positions truthful
      } else if (start < this.nextSample) {
        const overlap = Math.min(this.nextSample - start, samples.length);
        this.issues.push({ type: 'overlap', at: start, samples: overlap });
        this.session.overlaps += overlap;
        samples = samples.subarray(overlap);
        start = this.nextSample;
        if (!samples.length) return;
      }
      this.nextSample = start + samples.length;
      this.session.totalSamples = this.nextSample;

      let offset = 0;
      while (offset < samples.length) {
        const space = this.blockSamples - this.pendingLength;
        const n = Math.min(space, samples.length - offset);
        this.pending.set(samples.subarray(offset, offset + n), this.pendingLength);
        this.pendingLength += n;
        offset += n;
        if (this.pendingLength >= this.blockSamples) this._emitBlock();
      }
      this._scheduleManifest();
    }

    _emitBlock() {
      if (!this.pendingLength) return;
      const pcm = pcm16FromFloat32(this.pending.subarray(0, this.pendingLength));
      const startSample = this.session.flushedSamples;
      const block = {
        id: this.sessionId + ':' + this.blockSeq,
        sessionId: this.sessionId,
        seq: this.blockSeq++,
        startSample,
        sampleCount: pcm.length,
        pcm,
        createdAt: Date.now()
      };
      this.session.flushedSamples += pcm.length;
      this.session.blockCount++;
      this.pendingLength = 0;
      this.memoryBlocks.set(block.id, block);
      this._persistBlock(block);
      this._scheduleManifest();
    }

    _persistBlock(block) {
      const id = block.id;
      this.writeChain = this.writeChain.then(async () => {
        try {
          await this.adapter.putBlock({
            ...block,
            pcm: block.pcm.slice() // detach from the live buffer
          });
          this.memoryBlocks.delete(id);
          this.session.persistedSamples += block.sampleCount;
        } catch (e) {
          // Never throw into the recording path; keep the block in memory so the
          // session is still recoverable and report the failure honestly.
          this.session.storageFailed = true;
          this.session.storageError = (e && e.message) || 'storage failed';
        }
      });
      return this.writeChain;
    }

    _scheduleManifest(force = false) {
      const now = Date.now();
      this.session.updatedAt = now;
      // Throttle to at most once per second (forced on flush) so the ~85 ms
      // capture callbacks do not turn into a stream of storage writes.
      if (!force && now - this.lastManifestAt < 1000) return;
      this.lastManifestAt = now;
      this.writeChain = this.writeChain.then(async () => {
        // Snapshot when the write actually runs so persistedSamples reflects
        // every block queued before this manifest.
        const snapshot = { ...this.session, updatedAt: now };
        try { await this.adapter.putSession(snapshot); }
        catch (e) {
          this.session.storageFailed = true;
          this.session.storageError = (e && e.message) || 'storage failed';
        }
      });
    }

    // Persist the partial (<one block) tail without declaring the session done.
    // Used when the page is hidden, so a later crash loses at most one block.
    async flushPending() {
      if (this.discarded) return;
      if (this.pendingLength) this._emitBlock();
      this._scheduleManifest(true);
      await this.drain();
    }

    async flush() {
      if (this.discarded) return;
      if (this.pendingLength) this._emitBlock();
      this.session.complete = true;
      this._scheduleManifest(true);
      await this.drain();
    }

    async drain() {
      try { await this.writeChain; } catch {}
    }

    async coverage() {
      await this.drain();
      return {
        capturedSamples: this.nextSample,
        flushedSamples: this.session.flushedSamples,
        persistedSamples: this.session.persistedSamples,
        totalBlocks: this.session.blockCount,
        inMemoryBlocks: this.memoryBlocks.size,
        gaps: this.session.gaps,
        overlaps: this.session.overlaps,
        storageFailed: !!this.session.storageFailed,
        storageError: this.session.storageError || ''
      };
    }

    // Build a WAV from memory + storage. Only used for retry/download/recovery.
    async buildWav() {
      await this.drain();
      const byId = new Map();
      let stored = [];
      // Always merge storage with memory: an earlier block may have persisted
      // successfully before a later quota failure.
      try { stored = await this.adapter.getBlocks(this.sessionId); } catch {}
      for (const b of stored) byId.set(b.id, b);
      for (const b of this.memoryBlocks.values()) byId.set(b.id, b);
      const blocks = [...byId.values()]
        .map(b => ({ ...b, pcm: b.pcm instanceof Int16Array ? b.pcm : new Int16Array(b.pcm) }))
        .sort((a, b) => a.startSample - b.startSample);
      const { buffer, totalSamples } = wavFromPcm16Blocks(blocks, this.sampleRate);
      return { blob: new Blob([buffer], { type: 'audio/wav' }), totalSamples };
    }

    markPartial(reason) {
      this.session.partial = true;
      this.session.partialReason = reason || 'incomplete transcription';
      this._scheduleManifest(true);
    }

    async discard() {
      this.discarded = true;
      try { await this.drain(); } catch {}
      try { await this.adapter.deleteSession(this.sessionId); } catch {}
    }
  }

  // Recover a session from storage (used on page load and for Retry/Download).
  async function loadSessionAudio(adapter, sessionId, sampleRate) {
    const [session, blocks] = await Promise.all([
      adapter.getSession(sessionId),
      adapter.getBlocks(sessionId)
    ]);
    const ordered = [...blocks].sort((a, b) => a.startSample - b.startSample);
    const pcmBlocks = ordered.map(b => ({
      ...b,
      pcm: b.pcm instanceof Int16Array ? b.pcm : new Int16Array(b.pcm)
    }));
    const { buffer, totalSamples } = wavFromPcm16Blocks(pcmBlocks, sampleRate || 16000);
    return { session, blocks: pcmBlocks, buffer, totalSamples, blob: new Blob([buffer], { type: 'audio/wav' }) };
  }

  return {
    DEFAULT_SAMPLE_RATE,
    DEFAULT_BLOCK_SECONDS,
    pcm16FromFloat32,
    float32FromPcm16,
    StreamingResampler,
    MemoryAdapter,
    AudioLedger,
    loadSessionAudio,
    wavFromPcm16Blocks
  };
});
