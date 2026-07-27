// Pitch estimation and note-event stabilization. Pure and browser-independent.

export const frequencyToMidi = (frequency) =>
  69 + 12 * Math.log2(frequency / 440);

export const rmsOf = (samples) => {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
};

// YIN difference function with cumulative mean normalization and interpolation.
export const detectPitchYin = (samples, sampleRate, options = {}) => {
  const minFrequency = options.minFrequency ?? 82;
  const maxFrequency = options.maxFrequency ?? 1320;
  const threshold = options.threshold ?? 0.15;
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  const maxTau = Math.min(Math.floor(sampleRate / minFrequency), Math.floor(samples.length / 2));
  if (maxTau <= minTau) return null;

  const difference = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < samples.length - tau; i++) {
      const delta = samples[i] - samples[i + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  let running = 0;
  difference[0] = 1;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += difference[tau];
    difference[tau] = running === 0 ? 1 : difference[tau] * tau / running;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau++) {
    if (tau >= minTau && difference[tau] < threshold) {
      while (tau + 1 <= maxTau && difference[tau + 1] < difference[tau]) tau++;
      tauEstimate = tau;
      break;
    }
  }
  if (tauEstimate === -1) {
    let best = minTau;
    for (let tau = minTau + 1; tau <= maxTau; tau++) {
      if (difference[tau] < difference[best]) best = tau;
    }
    if (difference[best] > 0.3) return null;
    tauEstimate = best;
  }

  const left = difference[Math.max(1, tauEstimate - 1)];
  const center = difference[tauEstimate];
  const right = difference[Math.min(maxTau, tauEstimate + 1)];
  const denominator = 2 * (2 * center - right - left);
  const adjustedTau = denominator === 0
    ? tauEstimate
    : tauEstimate + (right - left) / denominator;
  return {
    frequency: sampleRate / adjustedTau,
    clarity: Math.max(0, Math.min(1, 1 - center)),
  };
};

export class NoteStabilizer {
  constructor(options = {}) {
    this.requiredFrames = options.requiredFrames ?? 3;
    this.silenceFrames = options.silenceFrames ?? 3;
    this.minClarity = options.minClarity ?? 0.82;
    this.minRms = options.minRms ?? 0.006;
    this.reset();
  }

  reset() {
    this.candidateMidi = null;
    this.candidateFrames = 0;
    this.activeMidi = null;
    this.silentFrames = 0;
  }

  update({ frequency, clarity = 0, rms = 0, onsetMs = performance.now() }) {
    if (!frequency || clarity < this.minClarity || rms < this.minRms) {
      this.candidateMidi = null;
      this.candidateFrames = 0;
      this.silentFrames++;
      if (this.silentFrames >= this.silenceFrames) this.activeMidi = null;
      return null;
    }

    this.silentFrames = 0;
    const midiFloat = frequencyToMidi(frequency);
    const midi = Math.round(midiFloat);
    if (midi === this.candidateMidi) this.candidateFrames++;
    else {
      this.candidateMidi = midi;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames < this.requiredFrames || midi === this.activeMidi) return null;

    this.activeMidi = midi;
    return {
      midi,
      frequency,
      cents: Math.round((midiFloat - midi) * 100),
      confidence: clarity,
      amplitude: rms,
      onsetMs,
    };
  }
}
