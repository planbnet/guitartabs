// Tab editing operations: insert/replace/shift/delete, blocks, clipboard.
//
// Functions mutate the store and emit bus events; they never touch the DOM.

import { STRING_COUNT, MIN_LEN, MAX_LEN } from "./constants.js";
import { emit } from "./bus.js";
import { clamp, isTabBlock, makeEmptyBlock, makeTextBlock } from "./model.js";
import {
  state,
  setCursor,
  clearSelection,
  getSelectionBounds,
  getClipboardData,
  setClipboardData,
  saveUndoState,
} from "./store.js";

const ALL_STRINGS = [0, 1, 2, 3, 4, 5];

const cellsChanged = (blockIdx) => {
  emit("cells-changed", { block: blockIdx });
  emit("dirty");
};

// --- Bar helpers ---

export const clearVerticalBar = (blockIdx, col) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  for (let s = 0; s < STRING_COUNT; s++) {
    state.blocks[blockIdx].data[s][col] = "-";
  }
};

export const findNextBar = (blockIdx, stringIdx, fromCol) => {
  if (!isTabBlock(state.blocks[blockIdx])) return -1;
  const row = state.blocks[blockIdx].data[stringIdx];
  for (let i = fromCol + 1; i < state.lineLength; i++) {
    if (row[i] === "|") return i;
  }
  return -1;
};

export const findPreviousBar = (blockIdx, stringIdx, toCol) => {
  if (!isTabBlock(state.blocks[blockIdx])) return -1;
  const row = state.blocks[blockIdx].data[stringIdx];
  for (let i = toCol - 1; i >= 0; i--) {
    if (row[i] === "|") return i;
  }
  return -1;
};

export const isFullVerticalBar = (blockIdx, col) => {
  const block = state.blocks[blockIdx];
  if (!isTabBlock(block)) return false;
  return block.data.every((row) => row[col] === "|");
};

const canShiftToNextBar = (blockIdx, stringIdx, fromCol, toCol) => {
  if (!isTabBlock(state.blocks[blockIdx])) return false;
  const row = state.blocks[blockIdx].data[stringIdx];
  for (let i = fromCol; i < toCol; i++) {
    if (row[i] === "-") return true;
  }
  return false;
};

// --- Character input ---

// Insert mode: shift only up to the next full bar when possible, so bar
// alignment across strings survives edits inside a measure.
export const smartInsertCharacter = (ch, forceFullLine = false) => {
  if (!isTabBlock(state.blocks[state.cur.block])) return;
  clearSelection();

  const { block: blockIdx, stringIdx, col } = state.cur;
  const row = state.blocks[blockIdx].data[stringIdx];
  const cursorOnFullBar = row[col] === "|" && isFullVerticalBar(blockIdx, col);

  if (forceFullLine || cursorOnFullBar) {
    saveUndoState();
    insertCharacterAtCursor(ch, { forceFullLine: true });
    return;
  }

  const nextBarCol = findNextBar(blockIdx, stringIdx, col);
  const shiftToBar =
    nextBarCol !== -1 &&
    isFullVerticalBar(blockIdx, nextBarCol) &&
    canShiftToNextBar(blockIdx, stringIdx, col, nextBarCol);

  saveUndoState();

  if (!shiftToBar) {
    insertCharacterAtCursor(ch);
    return;
  }

  // Would the cell before the bar be overwritten? Then shift the whole line.
  const charBeforeBar = row[nextBarCol - 1];
  if (charBeforeBar !== "-" && charBeforeBar !== "|") {
    insertCharacterAtCursor(ch);
    return;
  }

  for (let i = nextBarCol - 1; i > col; i--) {
    row[i] = row[i - 1];
  }
  row[col] = ch;

  if (state.cur.col < state.lineLength - 1) {
    setCursor(state.cur.block, state.cur.stringIdx, state.cur.col + 1);
  }
  cellsChanged(blockIdx);
};

// Insert mode deletes: pull content left only within the current bar section.
export const smartDeleteCharacter = (direction = "forward", forceFullLine = false) => {
  if (!isTabBlock(state.blocks[state.cur.block])) return;

  const { block: blockIdx, stringIdx, col } = state.cur;
  const row = state.blocks[blockIdx].data[stringIdx];

  let shiftToBar = false;
  let targetBarCol = -1;

  if (!forceFullLine) {
    if (direction === "forward") {
      targetBarCol = findNextBar(blockIdx, stringIdx, col);
      shiftToBar = targetBarCol !== -1 && isFullVerticalBar(blockIdx, targetBarCol);
    } else {
      targetBarCol = findPreviousBar(blockIdx, stringIdx, col);
      // No previous bar means we are in the first section — still shift smart.
      shiftToBar = targetBarCol === -1 || isFullVerticalBar(blockIdx, targetBarCol);
    }
  }

  if (shiftToBar && direction === "forward") {
    saveUndoState();
    for (let i = col; i < targetBarCol - 1; i++) {
      row[i] = row[i + 1];
    }
    row[targetBarCol - 1] = "-";
    cellsChanged(blockIdx);
  } else if (shiftToBar && direction === "backward") {
    const sectionEnd = findNextBar(blockIdx, stringIdx, col);
    const endCol = sectionEnd !== -1 ? sectionEnd : state.lineLength;
    saveUndoState();
    for (let i = col; i < endCol - 1; i++) {
      row[i] = row[i + 1];
    }
    row[endCol - 1] = "-";
    cellsChanged(blockIdx);
  } else {
    deleteSelectionOrChar(blockIdx, { rows: [stringIdx] });
  }
};

// Insert a character shifting content right; overflow cascades into the
// following tab blocks, creating a new block at the end when needed.
export const insertCharacterAtCursor = (ch, options = {}) => {
  if (!isTabBlock(state.blocks[state.cur.block])) return;
  clearSelection();

  const { forceFullLine = false } = options;
  const { lineLength } = state;
  const startBlock = state.cur.block;
  const col = state.cur.col;
  const currentBlock = state.blocks[startBlock];

  const rows = forceFullLine || state.editMode !== "insert"
    ? ALL_STRINGS
    : [state.cur.stringIdx];
  const uniqueRows = Array.from(new Set(rows.map((r) => clamp(r, 0, 5))));

  const touchedBlocks = new Set([startBlock]);
  let structureChanged = false;

  // Collect content that falls off the end of this block.
  let overflow = [];
  uniqueRows.forEach((stringIdx) => {
    const lastChar = currentBlock.data[stringIdx][lineLength - 1];
    if (lastChar !== "-" && lastChar !== "|") {
      overflow.push({ stringIdx, char: lastChar });
    }
  });

  uniqueRows.forEach((stringIdx) => {
    for (let i = lineLength - 1; i > col; i--) {
      currentBlock.data[stringIdx][i] = currentBlock.data[stringIdx][i - 1];
    }
    if (uniqueRows.length === STRING_COUNT && stringIdx !== state.cur.stringIdx) {
      currentBlock.data[stringIdx][col] = "-";
    }
  });

  if (currentBlock.data[state.cur.stringIdx][col] === "|") {
    clearVerticalBar(startBlock, col);
  }
  currentBlock.data[state.cur.stringIdx][col] = ch;

  // Cascade overflow through following tab blocks.
  let blockIdx = startBlock;
  while (overflow.length > 0 && blockIdx < state.blocks.length) {
    const nextIdx = blockIdx + 1;

    if (nextIdx < state.blocks.length && isTabBlock(state.blocks[nextIdx])) {
      const nextBlock = state.blocks[nextIdx];
      const nextOverflow = [];
      uniqueRows.forEach((stringIdx) => {
        const lastChar = nextBlock.data[stringIdx][lineLength - 1];
        if (lastChar !== "-" && lastChar !== "|") {
          nextOverflow.push({ stringIdx, char: lastChar });
        }
        for (let i = lineLength - 1; i > 0; i--) {
          nextBlock.data[stringIdx][i] = nextBlock.data[stringIdx][i - 1];
        }
        nextBlock.data[stringIdx][0] = "-";
      });
      overflow.forEach(({ stringIdx, char }) => {
        nextBlock.data[stringIdx][0] = char;
      });
      touchedBlocks.add(nextIdx);
      overflow = nextOverflow;
      blockIdx = nextIdx;
    } else {
      const newBlock = makeEmptyBlock(lineLength);
      overflow.forEach(({ stringIdx, char }) => {
        newBlock.data[stringIdx][0] = char;
      });
      state.blocks.splice(nextIdx, 0, newBlock);
      structureChanged = true;
      break;
    }
  }

  if (state.cur.col < lineLength - 1) {
    setCursor(state.cur.block, state.cur.stringIdx, state.cur.col + 1);
  }

  if (structureChanged) {
    emit("structure-changed");
    emit("dirty");
  } else {
    touchedBlocks.forEach((idx) => emit("cells-changed", { block: idx }));
    emit("dirty");
  }
};

export const handlePrintable = (ch, shiftKeyPressed = false) => {
  if (!isTabBlock(state.blocks[state.cur.block])) return;

  saveUndoState();
  clearSelection();

  // Spaces become dashes to keep tab lines uniform.
  const charToInsert = ch === " " ? "-" : ch;

  // "|" always draws a full vertical bar across all strings.
  if (charToInsert === "|") {
    for (let s = 0; s < STRING_COUNT; s++) {
      state.blocks[state.cur.block].data[s][state.cur.col] = "|";
    }
    if (state.cur.col < state.lineLength - 1) {
      setCursor(state.cur.block, state.cur.stringIdx, state.cur.col + 1);
    }
    cellsChanged(state.cur.block);
    return;
  }

  if (state.editMode === "shift") {
    insertCharacterAtCursor(charToInsert);
  } else if (state.editMode === "insert") {
    if (shiftKeyPressed) {
      insertCharacterAtCursor(charToInsert);
    } else {
      smartInsertCharacter(charToInsert);
    }
  } else {
    // Replace mode: overwrite in place, advance.
    const blockIdx = state.cur.block;
    if (state.blocks[blockIdx].data[state.cur.stringIdx][state.cur.col] === "|") {
      clearVerticalBar(blockIdx, state.cur.col);
    }
    state.blocks[blockIdx].data[state.cur.stringIdx][state.cur.col] = charToInsert;
    if (state.cur.col < state.lineLength - 1) {
      setCursor(state.cur.block, state.cur.stringIdx, state.cur.col + 1);
    } else if (state.cur.block < state.blocks.length - 1) {
      setCursor(state.cur.block + 1, state.cur.stringIdx, 0);
    }
    cellsChanged(blockIdx);
  }
};

// --- Commands ---

export const insertBarAtCursor = () => {
  if (!isTabBlock(state.blocks[state.cur.block])) return;
  saveUndoState();
  clearSelection();
  for (let s = 0; s < STRING_COUNT; s++) {
    state.blocks[state.cur.block].data[s][state.cur.col] = "|";
  }
  cellsChanged(state.cur.block);
};

// Insert a full bar column at an explicit position (double-click on a cell).
export const insertBarColumnAt = (blockIdx, col) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  saveUndoState();
  for (let s = 0; s < STRING_COUNT; s++) {
    state.blocks[blockIdx].data[s][col] = "|";
  }
  cellsChanged(blockIdx);
};

export const newTabBlock = () => {
  saveUndoState();
  clearSelection();
  state.blocks.splice(state.cur.block + 1, 0, makeEmptyBlock(state.lineLength));
  setCursor(state.cur.block + 1, 0, 0);
  emit("structure-changed");
  emit("dirty");
};

export const newTextBlock = () => {
  saveUndoState();
  clearSelection();
  state.blocks.splice(state.cur.block + 1, 0, makeTextBlock());
  setCursor(state.cur.block + 1, 0, 0);
  emit("structure-changed");
  emit("dirty");
};

export const deleteBlock = (blockIdx) => {
  if (state.blocks.length <= 1) return;
  saveUndoState();
  state.blocks.splice(blockIdx, 1);
  clearSelection();

  if (state.cur.block >= state.blocks.length) {
    state.cur.block = state.blocks.length - 1;
  } else if (state.cur.block >= blockIdx && state.cur.block > 0) {
    state.cur.block--;
  }
  state.cur.stringIdx = clamp(state.cur.stringIdx, 0, 5);
  state.cur.col = clamp(state.cur.col, 0, state.lineLength - 1);

  emit("structure-changed");
  emit("dirty");
};

export const moveBlock = (blockIdx, direction) => {
  const newIdx = blockIdx + direction;
  if (newIdx < 0 || newIdx >= state.blocks.length) return;

  saveUndoState();
  clearSelection();
  [state.blocks[blockIdx], state.blocks[newIdx]] = [state.blocks[newIdx], state.blocks[blockIdx]];

  if (state.cur.block === blockIdx) {
    state.cur.block = newIdx;
  } else if (state.cur.block === newIdx) {
    state.cur.block = blockIdx;
  }

  emit("structure-changed");
  emit("dirty");
};

export const applyLength = (len) => {
  saveUndoState();
  clearSelection();
  const L = clamp(len | 0, MIN_LEN, MAX_LEN);
  state.blocks = state.blocks.map((block) => {
    if (!isTabBlock(block)) return block;
    return {
      type: "tab",
      data: block.data.map((row) => {
        const out = new Array(L).fill("-");
        for (let i = 0; i < Math.min(row.length, L); i++) out[i] = row[i];
        return out;
      }),
    };
  });
  state.lineLength = L;
  state.cur.col = clamp(state.cur.col, 0, L - 1);
  emit("linelength-changed");
  emit("dirty");
};

// Reset the document to a single empty tab block. Confirmation is the UI's job.
export const clearAllBlocks = () => {
  saveUndoState();
  clearSelection();
  state.blocks = [makeEmptyBlock(state.lineLength)];
  setCursor(0, 0, 0);
  emit("structure-changed");
  emit("dirty");
};

// Shift rows right by `width` starting at startCol (used by paste and chords).
export const shiftBlockForInsert = (block, startCol, width, rows = null) => {
  if (width <= 0) return;
  const rowsToShift = rows && rows.length
    ? Array.from(new Set(rows.map((r) => clamp(r, 0, 5))))
    : ALL_STRINGS;
  rowsToShift.forEach((stringIdx) => {
    for (let i = state.lineLength - 1; i >= startCol + width; i--) {
      block.data[stringIdx][i] = block.data[stringIdx][i - width];
    }
    for (let i = startCol; i < Math.min(state.lineLength, startCol + width); i++) {
      block.data[stringIdx][i] = "-";
    }
  });
};

export const deleteSelectionOrChar = (blockIdx, options = {}) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  const bounds = getSelectionBounds();
  const { lineLength } = state;
  let rows = [];
  let startCol;
  let width;

  if (bounds && bounds.block === blockIdx && !options.ignoreSelection) {
    startCol = bounds.startCol;
    width = bounds.endCol - bounds.startCol + 1;
    for (let s = bounds.startString; s <= bounds.endString; s++) rows.push(s);
  } else {
    if (state.cur.block !== blockIdx) setCursor(blockIdx, 0, 0);
    startCol = state.cur.col;
    width = 1;
    if (options.allStrings) {
      rows = [...ALL_STRINGS];
    } else if (options.rows && options.rows.length) {
      rows = options.rows.map((r) => clamp(r, 0, 5));
    } else {
      rows = [state.cur.stringIdx];
    }
  }

  if (rows.length === 0) rows = [state.cur.stringIdx];
  startCol = clamp(startCol, 0, lineLength - 1);
  width = clamp(width, 1, lineLength - startCol);
  if (width <= 0) return;

  saveUndoState();
  const block = state.blocks[blockIdx];
  rows.forEach((stringIdx) => {
    const row = block.data[stringIdx];
    for (let c = startCol; c < lineLength - width; c++) {
      row[c] = row[c + width];
    }
    for (let c = Math.max(lineLength - width, 0); c < lineLength; c++) {
      row[c] = "-";
    }
  });

  setCursor(blockIdx, clamp(options.targetRow ?? rows[0], 0, 5), startCol);
  clearSelection();
  cellsChanged(blockIdx);
};

export const clearSelectionOrChar = (blockIdx) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  const bounds = getSelectionBounds();
  const { lineLength } = state;
  let startString, endString, startCol, width;

  if (bounds && bounds.block === blockIdx) {
    ({ startString, endString, startCol } = bounds);
    width = bounds.endCol - bounds.startCol + 1;
  } else {
    if (state.cur.block !== blockIdx) setCursor(blockIdx, 0, 0);
    startString = endString = state.cur.stringIdx;
    startCol = state.cur.col;
    width = 1;
  }

  startCol = clamp(startCol, 0, lineLength - 1);
  width = clamp(width, 1, lineLength - startCol);
  if (width <= 0) return;

  saveUndoState();
  const block = state.blocks[blockIdx];
  for (let stringIdx = startString; stringIdx <= endString; stringIdx++) {
    for (let c = startCol; c < startCol + width && c < lineLength; c++) {
      block.data[stringIdx][c] = "-";
    }
  }

  clearSelection();
  cellsChanged(blockIdx);
};

export const copySelectionFromBlock = (blockIdx) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  const bounds = getSelectionBounds();
  if (!bounds || bounds.block !== blockIdx) return;
  const width = bounds.endCol - bounds.startCol + 1;
  const height = bounds.endString - bounds.startString + 1;
  const payload = [];
  for (let s = bounds.startString; s <= bounds.endString; s++) {
    payload.push(state.blocks[blockIdx].data[s].slice(bounds.startCol, bounds.startCol + width));
  }
  setClipboardData({ width, height, data: payload });
  clearSelection();
};

export const pasteClipboardIntoBlock = (blockIdx) => {
  if (!isTabBlock(state.blocks[blockIdx])) return;
  if (state.cur.block !== blockIdx) return;
  const clipboard = getClipboardData();
  if (!clipboard) return;

  const { lineLength } = state;
  const startRow = clipboard.height === STRING_COUNT ? 0 : clamp(state.cur.stringIdx, 0, 5);
  const maxRows = Math.min(clipboard.height, STRING_COUNT - startRow);
  const startCol = clamp(state.cur.col, 0, lineLength - 1);
  const maxCols = Math.min(clipboard.width, lineLength - startCol);
  if (maxRows <= 0 || maxCols <= 0) return;

  saveUndoState();
  const block = state.blocks[blockIdx];
  const pastingFullTab = clipboard.height === STRING_COUNT;
  if (state.editMode === "shift" || pastingFullTab) {
    shiftBlockForInsert(block, startCol, maxCols);
  } else if (state.editMode === "insert") {
    const rowsToShift = Array.from({ length: maxRows }, (_, r) => startRow + r);
    shiftBlockForInsert(block, startCol, maxCols, rowsToShift);
  }

  for (let r = 0; r < maxRows; r++) {
    const sourceRow = clipboard.data[r] || [];
    for (let c = 0; c < maxCols; c++) {
      block.data[startRow + r][startCol + c] = sourceRow[c] ?? "-";
    }
  }

  clearSelection();
  setCursor(blockIdx, startRow, Math.min(lineLength - 1, startCol + maxCols - 1));
  cellsChanged(blockIdx);
};
