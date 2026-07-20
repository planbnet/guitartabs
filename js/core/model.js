// Pure functions over the block data model. No DOM, no shared state.
//
// A document is an array of blocks:
//   { type: 'tab',  data: char[6][lineLength] }
//   { type: 'text', data: string }

import { STRING_COUNT, TUNINGS } from "./constants.js";

export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export const makeEmptyBlock = (len) => ({
  type: "tab",
  data: Array.from({ length: STRING_COUNT }, () => new Array(len).fill("-")),
});

export const makeTextBlock = () => ({ type: "text", data: "" });

export const isTabBlock = (block) => !!block && block.type === "tab";
export const isTextBlock = (block) => !!block && block.type === "text";

// A "docked" text block is a single-line text block sitting directly above a
// tab block; it renders attached to that tab (used for chord/lyric lines).
export const isDockedTextBlock = (blocks, index) => {
  if (index < 0 || index >= blocks.length) return false;
  const block = blocks[index];
  if (!isTextBlock(block)) return false;
  if (block.data.includes("\n")) return false;
  return isTabBlock(blocks[index + 1]);
};

// Index of the docked text line above a tab block, or -1.
export const getDockedTextBeforeTab = (blocks, tabIdx) =>
  isDockedTextBlock(blocks, tabIdx - 1) ? tabIdx - 1 : -1;

// Index of the tab block a text line is docked to, or -1.
export const getDockedTabForText = (blocks, textIdx) =>
  isTabBlock(blocks[textIdx + 1]) ? textIdx + 1 : -1;

export const findPreviousTabBlock = (blocks, startIdx) => {
  for (let i = startIdx - 1; i >= 0; i--) {
    if (isTabBlock(blocks[i])) return i;
  }
  return -1;
};

export const findNextTabBlock = (blocks, startIdx) => {
  for (let i = startIdx + 1; i < blocks.length; i++) {
    if (isTabBlock(blocks[i])) return i;
  }
  return -1;
};

// True when the document contains anything beyond empty grids/bars.
export const hasMeaningfulContent = (blocks) =>
  blocks.some((block) => {
    if (isTextBlock(block)) return (block.data || "").trim() !== "";
    if (isTabBlock(block)) {
      return block.data.some((row) =>
        row.some((ch) => ch !== "-" && ch !== "|" && ch !== " ")
      );
    }
    return false;
  });

// --- Note math ---

const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_TO_SEMITONE = {
  c: 0, "c#": 1, d: 2, "d#": 3, e: 4, f: 5,
  "f#": 6, g: 7, "g#": 8, a: 9, "a#": 10, b: 11,
};

export const calculateNote = (stringIdx, fretNumber) => {
  if (stringIdx < 0 || stringIdx >= TUNINGS.length) return null;
  if (fretNumber < 0) return null;
  const base = NOTE_TO_SEMITONE[TUNINGS[stringIdx].toLowerCase()];
  if (base === undefined) return null;
  return NOTES[(base + fretNumber) % 12];
};

// Multi-digit fret number at a cell within a row (a char[] of one string).
// Runs longer than 2 digits, or values above 36, are read digit by digit.
export const getFretNumberInRow = (row, col) => {
  const char = row[col];
  if (!/\d/.test(char)) return null;

  let startCol = col;
  while (startCol > 0 && /\d/.test(row[startCol - 1])) startCol--;
  let endCol = col;
  while (endCol < row.length - 1 && /\d/.test(row[endCol + 1])) endCol++;

  const singleDigit = () => {
    const fret = parseInt(char, 10);
    return Number.isNaN(fret) ? null : fret;
  };

  if (endCol - startCol + 1 > 2) return singleDigit();

  const fret = parseInt(row.slice(startCol, endCol + 1).join(""), 10);
  if (Number.isNaN(fret)) return null;
  if (fret > 36) return singleDigit();
  return fret;
};
