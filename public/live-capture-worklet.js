// Live capture worklet: forwards mic PCM to the main thread in ~4096-sample
// blocks (same cadence as the old ScriptProcessor path, so chunking, backup,
// and the "real audio confirmed" timing stay identical).
// Runs off the main thread (no UI jank), unlike ScriptProcessorNode.
// No output — numberOfOutputs is 0, so unlike ScriptProcessor this node must
// NOT be connected to audioContext.destination.
class LiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(4096);
    this._idx = 0;
  }
  process(inputs) {
    const ch = inputs && inputs[0] && inputs[0][0];
    if (ch && ch.length) {
      let offset = 0;
      while (offset < ch.length) {
        const space = this._buf.length - this._idx;
        const n = Math.min(space, ch.length - offset);
        this._buf.set(ch.subarray(offset, offset + n), this._idx);
        this._idx += n;
        offset += n;
        if (this._idx >= this._buf.length) {
          this.port.postMessage(this._buf.slice(0));
          this._idx = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('live-capture', LiveCaptureProcessor);
