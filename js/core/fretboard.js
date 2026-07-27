// Pure guitar-fretboard helpers used by chord insertion and live listening.

import { clamp } from "./model.js";

export const OPEN_STRING_MIDI = [64, 59, 55, 50, 45, 40]; // high e → low E
export const MAX_LISTEN_FRET = 24;

const unique = (values) => [...new Set(values)];

export const midiToName = (midi) => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
};

export const enumerateNoteFingerings = (midi, options = {}) => {
  const maxFret = options.maxFret ?? MAX_LISTEN_FRET;
  const anchorFret = Number.isFinite(options.anchorFret) ? options.anchorFret : null;
  const previousString = Number.isInteger(options.previousString) ? options.previousString : null;
  const preferredString = Number.isInteger(options.preferredString) ? options.preferredString : null;

  return OPEN_STRING_MIDI.flatMap((openMidi, stringIdx) => {
    const fret = midi - openMidi;
    if (fret < 0 || fret > maxFret) return [];
    let score = fret * 0.08;
    if (anchorFret != null) score += Math.abs(fret - anchorFret) * 2.5;
    if (previousString != null) score += Math.abs(stringIdx - previousString) * 0.45;
    if (anchorFret == null && preferredString === stringIdx) score -= 2;
    if (fret === 0) score -= 0.2;

    const rows = ["", "", "", "", "", ""];
    rows[stringIdx] = String(fret);
    return [{
      label: `${midiToName(midi)} · ${["e", "B", "G", "D", "A", "E"][stringIdx]} string, fret ${fret}`,
      rows,
      width: String(fret).length,
      positionFret: fret,
      stringIdx,
      fret,
      score,
    }];
  }).sort((a, b) => a.score - b.score || a.stringIdx - b.stringIdx);
};

// chords-db stores low E first and frets relative to baseFret.
export const formatChordPositionForTab = (position) => {
  if (!position || !Array.isArray(position.frets)) return null;
  const frets = position.frets.slice();
  while (frets.length < 6) frets.push(-1);
  const baseFret = Math.max(position.baseFret || 1, 1);
  const rows = [];
  for (let i = 0; i < 6; i++) {
    const fretVal = frets[5 - i];
    if (typeof fretVal !== "number") rows.push("");
    else if (fretVal < 0) rows.push("x");
    else if (fretVal === 0) rows.push("0");
    else rows.push(String(Math.max(fretVal + baseFret - 1, 0)));
  }
  const width = Math.max(1, ...rows.map((value) => value.length || 0));
  const playedFrets = rows
    .map((value) => parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value > 0);
  const positionFret = playedFrets.length
    ? playedFrets.reduce((sum, value) => sum + value, 0) / playedFrets.length
    : 0;
  return { rows, width, positionFret };
};

const chordLabel = (key, suffix) => {
  if (suffix === "major") return key;
  if (suffix === "minor") return `${key}m`;
  return `${key}${suffix}`;
};

const pitchClassesForRows = (rows) =>
  unique(rows.flatMap((value, stringIdx) => {
    if (value === "" || value === "x") return [];
    const fret = parseInt(value, 10);
    return Number.isFinite(fret) ? [(OPEN_STRING_MIDI[stringIdx] + fret) % 12] : [];
  }));

export const rankChordShapes = (database, detectedPitches, options = {}) => {
  if (!database || !Array.isArray(detectedPitches) || detectedPitches.length < 2) return [];
  const detectedClasses = unique(detectedPitches.map((pitch) => pitch.midi % 12));
  const detectedBass = detectedPitches.reduce((lowest, pitch) =>
    pitch.midi < lowest.midi ? pitch : lowest
  ).midi % 12;
  const anchorFret = Number.isFinite(options.anchorFret) ? options.anchorFret : null;
  const out = [];

  for (const key of database.keys || []) {
    for (const chord of database.chords?.[key] || []) {
      for (const position of chord.positions || []) {
        const formatted = formatChordPositionForTab(position);
        if (!formatted) continue;
        const shapeClasses = pitchClassesForRows(formatted.rows);
        const matched = detectedClasses.filter((pc) => shapeClasses.includes(pc)).length;
        const missing = detectedClasses.length - matched;
        const added = shapeClasses.filter((pc) => !detectedClasses.includes(pc)).length;
        const lowestShapeMidi = formatted.rows.reduce((lowest, value, stringIdx) => {
          if (value === "" || value === "x") return lowest;
          const fret = parseInt(value, 10);
          const midi = OPEN_STRING_MIDI[stringIdx] + fret;
          return Math.min(lowest, midi);
        }, Infinity);
        const bassMatches = Number.isFinite(lowestShapeMidi) && lowestShapeMidi % 12 === detectedBass;
        const confidence = detectedPitches.reduce((sum, pitch) => sum + (pitch.confidence ?? 1), 0) /
          detectedPitches.length;
        let score = matched * 10 - missing * 8 - added * 2.5 + (bassMatches ? 3 : 0) + confidence;
        if (anchorFret != null) score -= Math.abs(formatted.positionFret - anchorFret) * 0.8;
        else score -= formatted.positionFret * 0.05;
        out.push({
          label: chordLabel(key, chord.suffix),
          rows: formatted.rows,
          width: formatted.width,
          positionFret: formatted.positionFret,
          score,
          pitchCoverage: matched / detectedClasses.length,
          addedTones: added,
          suffix: chord.suffix,
          key,
        });
      }
    }
  }

  const seen = new Set();
  return out
    .sort((a, b) => b.score - a.score || a.positionFret - b.positionFret)
    .filter((candidate) => {
      const signature = `${candidate.label}:${candidate.rows.join(",")}`;
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, options.limit ?? 24);
};

export const findFretAnchorBeforeCursor = (blocks, blockIdx, col) => {
  const block = blocks[blockIdx];
  if (!block || block.type !== "tab") return null;
  for (let c = clamp(col - 1, 0, block.data[0].length - 1); c >= 0; c--) {
    const frets = [];
    for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
      if (!/\d/.test(block.data[stringIdx][c])) continue;
      let start = c;
      while (start > 0 && /\d/.test(block.data[stringIdx][start - 1])) start--;
      const value = parseInt(block.data[stringIdx].slice(start, c + 1).join(""), 10);
      if (Number.isFinite(value) && value <= 36) frets.push(value);
    }
    if (frets.length) return frets.reduce((sum, fret) => sum + fret, 0) / frets.length;
  }
  return null;
};

