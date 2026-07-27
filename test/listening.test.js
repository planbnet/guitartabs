import { describe, expect, it } from "vitest";
import { makeEmptyBlock, makeTextBlock } from "../js/core/model.js";
import {
  detectPitchYin,
  frequencyToMidi,
  NoteStabilizer,
  rmsOf,
} from "../js/core/pitch.js";
import {
  enumerateNoteFingerings,
  formatChordPositionForTab,
  rankChordShapes,
} from "../js/core/fretboard.js";
import {
  materializeListeningPhrase,
  phraseWidth,
} from "../js/core/listening-session.js";
import {
  groupNotesIntoChords,
  measureChordActivity,
} from "../js/audio/chord-engine.js";

const sine = (frequency, sampleRate = 44100, length = 2048) =>
  Float32Array.from({ length }, (_, index) =>
    0.4 * Math.sin(2 * Math.PI * frequency * index / sampleRate)
  );

const candidate = (rows) => ({
  label: "test",
  rows,
  width: Math.max(1, ...rows.map((value) => value.length)),
  positionFret: 5,
});

describe("pitch detection", () => {
  it("estimates a clean guitar-range sine wave", () => {
    const samples = sine(110, 44100, 4096);
    const result = detectPitchYin(samples, 44100);
    expect(result.frequency).toBeCloseTo(110, 0);
    expect(result.clarity).toBeGreaterThan(0.9);
    expect(rmsOf(samples)).toBeGreaterThan(0.25);
    expect(Math.round(frequencyToMidi(result.frequency))).toBe(45);
  });

  it("emits only after stable frames and rearms after silence", () => {
    const stabilizer = new NoteStabilizer({ requiredFrames: 3, silenceFrames: 2 });
    const frame = { frequency: 110, clarity: 0.95, rms: 0.2, onsetMs: 1 };
    expect(stabilizer.update(frame)).toBeNull();
    expect(stabilizer.update(frame)).toBeNull();
    expect(stabilizer.update(frame).midi).toBe(45);
    expect(stabilizer.update(frame)).toBeNull();
    stabilizer.update({ frequency: 0, clarity: 0, rms: 0 });
    stabilizer.update({ frequency: 0, clarity: 0, rms: 0 });
    stabilizer.update(frame);
    stabilizer.update(frame);
    expect(stabilizer.update(frame).midi).toBe(45);
  });
});

describe("fretboard candidates", () => {
  it("enumerates every E4 position through fret 24", () => {
    const candidates = enumerateNoteFingerings(64);
    expect(candidates.map(({ stringIdx, fret }) => [stringIdx, fret])).toEqual(
      expect.arrayContaining([[0, 0], [1, 5], [2, 9], [3, 14], [4, 19], [5, 24]])
    );
  });

  it("uses a chosen position as the dominant ranking signal", () => {
    const candidates = enumerateNoteFingerings(64, { anchorFret: 9, previousString: 2 });
    expect(candidates[0]).toMatchObject({ stringIdx: 2, fret: 9 });
  });

  it("formats chords-db relative frets in high-e-first order", () => {
    const result = formatChordPositionForTab({
      frets: [-1, 3, 2, 0, 1, 0],
      baseFret: 1,
    });
    expect(result.rows).toEqual(["0", "1", "0", "2", "3", "x"]);
    expect(result.width).toBe(1);
  });

  it("ranks a common C shape for detected C major pitch classes", () => {
    const database = {
      keys: ["C", "D"],
      chords: {
        C: [{ suffix: "major", positions: [{ frets: [-1, 3, 2, 0, 1, 0], baseFret: 1 }] }],
        D: [{ suffix: "major", positions: [{ frets: [-1, -1, 0, 2, 3, 2], baseFret: 1 }] }],
      },
    };
    const pitches = [48, 52, 55].map((midi) => ({ midi, confidence: 0.9 }));
    expect(rankChordShapes(database, pitches)[0].label).toBe("C");
  });
});

describe("listening phrase materialization", () => {
  const noteEvent = (rows) => ({
    candidates: [candidate(rows)],
    selectedCandidate: 0,
  });

  it("writes compact events in replace mode", () => {
    const blocks = [makeEmptyBlock(8)];
    const events = [
      noteEvent(["3", "", "", "", "", ""]),
      noteEvent(["", "10", "", "", "", ""]),
    ];
    expect(phraseWidth(events)).toBe(5);
    const result = materializeListeningPhrase({
      baselineBlocks: blocks,
      startBlock: 0,
      startCol: 1,
      lineLength: 8,
      editMode: "replace",
      events,
    });
    expect(result.blocks[0].data[0].join("")).toBe("-3------");
    expect(result.blocks[0].data[1].join("")).toBe("---10---");
  });

  it("inserts before existing content and overflows into a new tab block", () => {
    const block = makeEmptyBlock(6);
    block.data[0][5] = "7";
    const events = [noteEvent(["12", "", "", "", "", ""])];
    const result = materializeListeningPhrase({
      baselineBlocks: [block],
      startBlock: 0,
      startCol: 4,
      lineLength: 6,
      editMode: "insert",
      events,
    });
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].data[0].join("")).toBe("----12");
    expect(result.blocks[1].data[0][2]).toBe("7");
  });

  it("inserts overflow before a following text section without touching later tabs", () => {
    const current = makeEmptyBlock(4);
    current.data[0][3] = "7";
    const text = makeTextBlock();
    text.data = "Verse";
    const later = makeEmptyBlock(4);
    later.data[0][0] = "9";
    const events = [noteEvent(["12", "", "", "", "", ""])];
    const result = materializeListeningPhrase({
      baselineBlocks: [current, text, later],
      startBlock: 0,
      startCol: 3,
      startString: 2,
      lineLength: 4,
      editMode: "insert",
      events,
    });

    expect(result.blocks).toHaveLength(4);
    expect(result.blocks[1].type).toBe("tab");
    expect(result.blocks[2]).toEqual(text);
    expect(result.blocks[3]).toEqual(later);
    expect(result.blocks[1].data[0][2]).toBe("7");
    expect(result.cur.stringIdx).toBe(2);
  });
});

describe("polyphonic note grouping", () => {
  it("groups a strum and suppresses release onsets while those pitches sustain", () => {
    const notes = [
      { pitchMidi: 60, amplitude: 0.7, startTimeSeconds: 0.02, durationSeconds: 1.7 },
      { pitchMidi: 64, amplitude: 0.7, startTimeSeconds: 0.04, durationSeconds: 1.7 },
      { pitchMidi: 67, amplitude: 0.7, startTimeSeconds: 0.08, durationSeconds: 1.7 },
      { pitchMidi: 64, amplitude: 0.5, startTimeSeconds: 1.65, durationSeconds: 0.2 },
      { pitchMidi: 67, amplitude: 0.5, startTimeSeconds: 1.67, durationSeconds: 0.2 },
    ];
    const groups = groupNotesIntoChords(notes);
    expect(groups).toHaveLength(1);
    expect(groups[0].pitches.map((pitch) => pitch.midi).sort()).toEqual([60, 64, 67]);
  });

  it("keeps a later event when it introduces a new pitch", () => {
    const notes = [
      { pitchMidi: 60, amplitude: 0.7, startTimeSeconds: 0, durationSeconds: 1.5 },
      { pitchMidi: 64, amplitude: 0.7, startTimeSeconds: 0, durationSeconds: 1.5 },
      { pitchMidi: 67, amplitude: 0.7, startTimeSeconds: 0, durationSeconds: 1.5 },
      { pitchMidi: 62, amplitude: 0.7, startTimeSeconds: 1, durationSeconds: 0.5 },
      { pitchMidi: 65, amplitude: 0.7, startTimeSeconds: 1, durationSeconds: 0.5 },
    ];
    expect(groupNotesIntoChords(notes)).toHaveLength(2);
  });
});

describe("chord activity gate", () => {
  const sampleRate = 22050;

  it("rejects silence and steady low-level input noise", () => {
    expect(measureChordActivity(new Float32Array(sampleRate * 2), sampleRate).active).toBe(false);
    const hum = Float32Array.from({ length: sampleRate * 2 }, (_, index) =>
      0.003 * Math.sin(2 * Math.PI * 50 * index / sampleRate)
    );
    expect(measureChordActivity(hum, sampleRate).active).toBe(false);
  });

  it("accepts a guitar-like transient above the measured noise floor", () => {
    const signal = Float32Array.from({ length: sampleRate * 2 }, (_, index) => {
      if (index < sampleRate * 0.2) return 0.001;
      const elapsed = index / sampleRate - 0.2;
      const envelope = 0.12 * Math.exp(-elapsed * 2.4);
      return envelope * (
        Math.sin(2 * Math.PI * 196 * elapsed) +
        Math.sin(2 * Math.PI * 246.94 * elapsed) +
        Math.sin(2 * Math.PI * 293.66 * elapsed)
      ) / 3;
    });
    expect(measureChordActivity(signal, sampleRate).active).toBe(true);
  });
});
