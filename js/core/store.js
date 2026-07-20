// Central application state and its mutators.
//
// All state lives on the exported `state` object; nothing else may mutate it.
// Mutators emit bus events instead of calling into the UI, so this module
// stays DOM-free and unit-testable.

import { DEFAULT_LEN, MAX_UNDO } from "./constants.js";
import { emit } from "./bus.js";
import { clamp, makeEmptyBlock } from "./model.js";

export const EDIT_MODES = ["replace", "shift", "insert"];

export const state = {
  blocks: [],
  lineLength: DEFAULT_LEN,
  cur: { block: 0, stringIdx: 0, col: 0 },
  editMode: "replace",
  selection: null,
  clipboard: null,
  undoStack: [],
  isUndoing: false,
  keyboardSelectionAnchor: null,
};

// --- Cursor ---

export const setCursor = (blockIdx, stringIdx, col) => {
  state.cur.block = clamp(blockIdx, 0, state.blocks.length - 1);
  state.cur.stringIdx = clamp(stringIdx, 0, 5);
  state.cur.col = clamp(col, 0, state.lineLength - 1);
  emit("cursor-changed");
  emit("clipboard-changed");
};

export const moveCursor = (dBlock, dString, dCol) => {
  setCursor(
    state.cur.block + dBlock,
    state.cur.stringIdx + dString,
    state.cur.col + dCol
  );
};

// --- Selection ---

const normalizeSelection = (sel) => {
  if (!sel || sel.block == null) return null;
  if (sel.block < 0 || sel.block >= state.blocks.length) return null;
  const startString = clamp(Math.min(sel.startString, sel.endString ?? sel.startString), 0, 5);
  const endString = clamp(Math.max(sel.startString, sel.endString ?? sel.startString), 0, 5);
  const startCol = clamp(Math.min(sel.startCol, sel.endCol ?? sel.startCol), 0, state.lineLength - 1);
  const endCol = clamp(Math.max(sel.startCol, sel.endCol ?? sel.startCol), 0, state.lineLength - 1);
  return { block: sel.block, startString, endString, startCol, endCol };
};

export const setSelection = (sel) => {
  state.selection = normalizeSelection(sel);
  if (!state.selection) resetKeyboardSelectionAnchor();
  emit("selection-changed");
};

export const clearSelection = () => setSelection(null);

export const getSelectionBounds = () =>
  state.selection ? { ...state.selection } : null;

// --- Keyboard (shift+arrow) selection ---

export const resetKeyboardSelectionAnchor = () => {
  state.keyboardSelectionAnchor = null;
};

export const startKeyboardSelection = () => {
  if (state.keyboardSelectionAnchor) return;
  const { cur, selection } = state;
  if (selection && selection.block === cur.block) {
    state.keyboardSelectionAnchor = {
      block: selection.block,
      stringIdx: selection.startString,
      col: selection.startCol,
    };
  } else {
    state.keyboardSelectionAnchor = { block: cur.block, stringIdx: cur.stringIdx, col: cur.col };
  }
};

export const updateKeyboardSelection = () => {
  const anchor = state.keyboardSelectionAnchor;
  if (!anchor) return;
  const { cur } = state;
  if (anchor.block !== cur.block) {
    state.keyboardSelectionAnchor = { block: cur.block, stringIdx: cur.stringIdx, col: cur.col };
    setSelection(null);
    return;
  }
  setSelection({
    block: cur.block,
    startString: anchor.stringIdx,
    endString: cur.stringIdx,
    startCol: anchor.col,
    endCol: cur.col,
  });
};

// --- Clipboard ---

export const setClipboardData = (data) => {
  state.clipboard = data ? structuredClone(data) : null;
  emit("clipboard-changed");
};

export const getClipboardData = () =>
  state.clipboard ? structuredClone(state.clipboard) : null;

export const hasClipboardData = () => !!state.clipboard;

// --- Edit mode ---

export const setEditMode = (mode) => {
  if (!EDIT_MODES.includes(mode) || mode === state.editMode) return;
  saveUndoState();
  state.editMode = mode;
  emit("editmode-changed");
  emit("dirty");
};

export const cycleEditMode = () => {
  const idx = EDIT_MODES.indexOf(state.editMode);
  setEditMode(EDIT_MODES[(idx + 1) % EDIT_MODES.length]);
};

// --- Undo ---

export const saveUndoState = () => {
  if (state.isUndoing) return;
  state.undoStack.push({
    blocks: structuredClone(state.blocks),
    cur: { ...state.cur },
    editMode: state.editMode,
    lineLength: state.lineLength,
  });
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
};

export const undo = () => {
  const snapshot = state.undoStack.pop();
  if (!snapshot) return;

  state.isUndoing = true;
  state.blocks = snapshot.blocks;
  state.cur = snapshot.cur;
  state.editMode = snapshot.editMode;
  state.lineLength = snapshot.lineLength;

  emit("document-replaced");
  emit("editmode-changed");
  emit("dirty");
  clearSelection();
  state.isUndoing = false;
};

// --- Document ---

export const ensureAtLeastOneBlock = () => {
  if (state.blocks.length === 0) state.blocks.push(makeEmptyBlock(state.lineLength));
};

// Swap in a whole new document (load, import, share link).
export const replaceDocument = ({ blocks, lineLength, cur, editMode }) => {
  state.blocks = blocks;
  if (lineLength) state.lineLength = lineLength;
  state.cur = cur || { block: 0, stringIdx: 0, col: 0 };
  if (editMode) state.editMode = editMode;
  ensureAtLeastOneBlock();
  clearSelection();
  emit("document-replaced");
  emit("editmode-changed");
  emit("dirty");
};
