const TARGET_SAMPLE_RATE = 22050;
const WINDOW_SECONDS = 2.0;
const STEP_SECONDS = 1.2;

export const measureChordActivity = (samples, sampleRate, sensitivity = 0.5) => {
  if (!samples.length || !sampleRate) {
    return { active: false, peakRms: 0, noiseFloor: 0, overallRms: 0 };
  }

  const frameSize = Math.max(64, Math.floor(sampleRate * 0.02));
  const frameLevels = [];
  let totalSquares = 0;
  for (let start = 0; start < samples.length; start += frameSize) {
    const end = Math.min(samples.length, start + frameSize);
    let frameSquares = 0;
    for (let i = start; i < end; i++) {
      const square = samples[i] * samples[i];
      frameSquares += square;
      totalSquares += square;
    }
    frameLevels.push(Math.sqrt(frameSquares / Math.max(1, end - start)));
  }

  const sorted = [...frameLevels].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.25)] || 0;
  const peakRms = sorted[sorted.length - 1] || 0;
  const overallRms = Math.sqrt(totalSquares / samples.length);
  const amount = Math.max(0, Math.min(1, Number(sensitivity)));
  const absolutePeakGate = 0.018 - amount * 0.012;
  const noiseRatioGate = 3.2 - amount * 1.2;
  const active =
    peakRms >= absolutePeakGate &&
    peakRms >= Math.max(0.001, noiseFloor) * noiseRatioGate &&
    overallRms >= absolutePeakGate * 0.2;

  return { active, peakRms, noiseFloor, overallRms };
};

const resampleLinear = (source, sourceRate, targetRate = TARGET_SAMPLE_RATE) => {
  if (sourceRate === targetRate) return source;
  const length = Math.max(1, Math.round(source.length * targetRate / sourceRate));
  const result = new Float32Array(length);
  const ratio = sourceRate / targetRate;
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(source.length - 1, left + 1);
    const fraction = position - left;
    result[i] = source[left] * (1 - fraction) + source[right] * fraction;
  }
  return result;
};

export const groupNotesIntoChords = (notes, windowStartSeconds = 0) => {
  const sorted = notes
    .filter((note) =>
      note.pitchMidi >= 40 &&
      note.pitchMidi <= 88 &&
      note.amplitude >= 0.15 &&
      note.startTimeSeconds < WINDOW_SECONDS - 0.25
    )
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  const groups = [];
  for (const note of sorted) {
    const absoluteOnset = windowStartSeconds + note.startTimeSeconds;
    const group = groups.find((candidate) => Math.abs(candidate.onset - absoluteOnset) <= 0.18);
    const pitch = {
      midi: note.pitchMidi,
      amplitude: note.amplitude,
      confidence: Math.min(1, note.amplitude),
      onsetMs: absoluteOnset * 1000,
      end: absoluteOnset + note.durationSeconds,
    };
    if (group) group.pitches.push(pitch);
    else groups.push({ onset: absoluteOnset, pitches: [pitch] });
  }

  return groups.filter((group) => {
    const groupPitches = new Set(group.pitches.map((pitch) => pitch.midi));
    const alreadySustained = sorted
      .filter((note) => {
        const onset = windowStartSeconds + note.startTimeSeconds;
        const end = onset + note.durationSeconds;
        return onset < group.onset - 0.18 && end >= group.onset - 0.05;
      })
      .map((note) => note.pitchMidi);
    if (!alreadySustained.length) return true;
    const sustained = new Set(alreadySustained);
    return [...groupPitches].some((midi) => !sustained.has(midi));
  }).map((group) => ({
    ...group,
    pitches: [...new Map(group.pitches.map((pitch) => [pitch.midi, pitch])).values()],
  }));
};

export class ChordEngine {
  constructor({ onChord, onLevel, onStatus } = {}) {
    this.onChord = onChord || (() => {});
    this.onLevel = onLevel || (() => {});
    this.onStatus = onStatus || (() => {});
    this.samples = [];
    this.sampleRate = 0;
    this.nextWindowStart = 0;
    this.bufferStartSamples = 0;
    this.processing = false;
    this.queued = false;
    this.model = null;
    this.library = null;
    this.loadPromise = null;
    this.seen = new Set();
    this.generation = 0;
    this.sensitivity = 0.5;
  }

  setSensitivity(value) {
    this.sensitivity = Math.max(0, Math.min(1, Number(value)));
  }

  async load() {
    if (this.loadPromise) return this.loadPromise;
    if (this.model) return;
    try {
      this.loadPromise = (async () => {
        this.onStatus("Loading local chord model…");
        this.library = await import("../vendor/basic-pitch.bundle.js");
        const modelUrl = new URL("../vendor/basic-pitch-model/model.json", import.meta.url).href;
        this.model = new this.library.BasicPitch(modelUrl);
        await this.model.model;
        this.onStatus("Chord model ready");
      })();
      await this.loadPromise;
    } catch (error) {
      this.model = null;
      throw error;
    } finally {
      this.loadPromise = null;
    }
  }

  reset() {
    this.generation++;
    this.samples = [];
    this.sampleRate = 0;
    this.nextWindowStart = 0;
    this.bufferStartSamples = 0;
    this.queued = false;
    this.seen.clear();
  }

  push(chunk, sampleRate) {
    if (!this.sampleRate) this.sampleRate = sampleRate;
    if (sampleRate !== this.sampleRate) this.reset();
    this.sampleRate = sampleRate;
    for (const value of chunk) this.samples.push(value);
    let sum = 0;
    for (const value of chunk) sum += value * value;
    this.onLevel(Math.min(1, Math.sqrt(sum / Math.max(1, chunk.length)) * 18));
    const windowLength = Math.floor(this.sampleRate * WINDOW_SECONDS);
    if (this.samples.length - this.nextWindowStart < windowLength) return;
    if (this.processing) {
      this.queued = true;
      return;
    }
    void this.processAvailable();
  }

  async processAvailable() {
    if (this.processing || !this.sampleRate) return;
    const windowLength = Math.floor(this.sampleRate * WINDOW_SECONDS);
    if (this.samples.length - this.nextWindowStart < windowLength) return;
    this.processing = true;
    const generation = this.generation;
    try {
      const start = this.nextWindowStart;
      const source = Float32Array.from(this.samples.slice(start, start + windowLength));
      const windowStartSeconds = (this.bufferStartSamples + start) / this.sampleRate;
      this.advanceWindow(windowLength);

      const activity = measureChordActivity(source, this.sampleRate, this.sensitivity);
      if (!activity.active) {
        this.onStatus("Waiting for a clear strum…");
        return;
      }

      this.onStatus("Analyzing chord…");
      await this.load();
      const input = resampleLinear(source, this.sampleRate);
      const frames = [];
      const onsets = [];
      const contours = [];
      await this.model.evaluateModel(
        input,
        (newFrames, newOnsets, newContours) => {
          frames.push(...newFrames);
          onsets.push(...newOnsets);
          contours.push(...newContours);
        },
        () => {}
      );
      const onsetThreshold = 0.5 - this.sensitivity * 0.16;
      const frameThreshold = 0.42 - this.sensitivity * 0.16;
      const noteFrames = this.library.outputToNotesPoly(
        frames,
        onsets,
        onsetThreshold,
        frameThreshold,
        4
      );
      const notes = this.library.noteFramesToTime(
        this.library.addPitchBendsToNoteEvents(contours, noteFrames)
      );
      if (generation !== this.generation) return;
      this.emitChordGroups(notes, windowStartSeconds);
    } catch (error) {
      this.onStatus(`Chord analysis failed: ${error.message || error}`);
    } finally {
      this.processing = false;
      if (this.queued) {
        this.queued = false;
        void this.processAvailable();
      }
    }
  }

  advanceWindow(windowLength) {
    this.nextWindowStart += Math.floor(this.sampleRate * STEP_SECONDS);
    const discard = Math.max(0, this.nextWindowStart - windowLength);
    if (discard > 0) {
      this.samples.splice(0, discard);
      this.nextWindowStart -= discard;
      this.bufferStartSamples += discard;
    }
  }

  emitChordGroups(notes, windowStartSeconds) {
    for (const group of groupNotesIntoChords(notes, windowStartSeconds)) {
      if (group.pitches.length < 2) continue;
      const signature = `${Math.round(group.onset * 5)}:${group.pitches.map((p) => p.midi).sort().join(",")}`;
      if (this.seen.has(signature)) continue;
      this.seen.add(signature);
      this.onChord(group.pitches);
    }
    if (this.seen.size > 200) this.seen = new Set([...this.seen].slice(-100));
  }
}
