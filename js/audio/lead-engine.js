import { detectPitchYin, NoteStabilizer, rmsOf } from "../core/pitch.js";

export class LeadEngine {
  constructor({ onPitch, onLevel } = {}) {
    this.onPitch = onPitch || (() => {});
    this.onLevel = onLevel || (() => {});
    this.frameSize = 2048;
    this.ring = new Float32Array(this.frameSize);
    this.ringOffset = 0;
    this.samplesSinceAnalysis = 0;
    this.stabilizer = new NoteStabilizer();
    this.sensitivity = 0.5;
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(0, Math.min(1, Number(value)));
    this.stabilizer.minClarity = 0.9 - this.sensitivity * 0.14;
    this.stabilizer.minRms = 0.012 - this.sensitivity * 0.009;
  }

  reset() {
    this.ring.fill(0);
    this.ringOffset = 0;
    this.samplesSinceAnalysis = 0;
    this.stabilizer.reset();
  }

  push(samples, sampleRate) {
    for (const sample of samples) {
      this.ring[this.ringOffset] = sample;
      this.ringOffset = (this.ringOffset + 1) % this.frameSize;
    }
    this.samplesSinceAnalysis += samples.length;
    const hop = Math.max(256, Math.floor(sampleRate * 0.04));
    if (this.samplesSinceAnalysis < hop) return;
    this.samplesSinceAnalysis %= hop;

    const frame = new Float32Array(this.frameSize);
    const tail = this.frameSize - this.ringOffset;
    frame.set(this.ring.subarray(this.ringOffset), 0);
    frame.set(this.ring.subarray(0, this.ringOffset), tail);
    const rms = rmsOf(frame);
    this.onLevel(Math.min(1, rms * 18));
    const estimate = detectPitchYin(frame, sampleRate);
    const pitch = this.stabilizer.update({
      frequency: estimate?.frequency,
      clarity: estimate?.clarity || 0,
      rms,
      onsetMs: performance.now(),
    });
    if (pitch) this.onPitch(pitch);
  }
}

