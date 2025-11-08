// === Tab Editor State Management ===

// Constants
const tunings = ["e", "B", "G", "D", "A", "E"]; // high to low
const DEFAULT_LEN = 80;

// Note calculation
const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteToSemitone = {
  "C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
  "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11,
  "c": 0, "c#": 1, "d": 2, "d#": 3, "e": 4, "f": 5,
  "f#": 6, "g": 7, "g#": 8, "a": 9, "a#": 10, "b": 11
};

const calculateNote = (stringIdx, fretNumber) => {
  if (stringIdx < 0 || stringIdx >= tunings.length) return null;
  if (fretNumber < 0) return null;
  
  const openNote = tunings[stringIdx];
  const baseSemitone = noteToSemitone[openNote];
  if (baseSemitone === undefined) return null;
  
  const resultSemitone = (baseSemitone + fretNumber) % 12;
  return notes[resultSemitone];
};

// Application State
let blocks = [];
let lineLength = DEFAULT_LEN;
let cur = { block: 0, stringIdx: 0, col: 0 };
let editMode = 'replace';

// Undo System
let undoStack = [];
let maxUndoSteps = 50;
let isUndoing = false;

// Drag State
let selectionDrag = { active: false, pending: false, timer: null, block: null, anchor: null, pointerType: null, touchId: null };
let selection = null;
let clipboardData = null;
let keyboardSelectionAnchor = null;

const normalizeSelection = (sel) => {
  if (!sel || sel.block == null) return null;
  if (sel.block < 0 || sel.block >= blocks.length) return null;
  const startString = clamp(Math.min(sel.startString, sel.endString ?? sel.startString), 0, 5);
  const endString = clamp(Math.max(sel.startString, sel.endString ?? sel.startString), 0, 5);
  const startCol = clamp(Math.min(sel.startCol, sel.endCol ?? sel.startCol), 0, lineLength - 1);
  const endCol = clamp(Math.max(sel.startCol, sel.endCol ?? sel.startCol), 0, lineLength - 1);
  return { block: sel.block, startString, endString, startCol, endCol };
};

const resetKeyboardSelectionAnchor = () => {
  keyboardSelectionAnchor = null;
};

const setSelection = (sel) => {
  selection = normalizeSelection(sel);
  if (!selection) {
    resetKeyboardSelectionAnchor();
  }
  if (typeof updateSelectionHighlight === "function") {
    updateSelectionHighlight();
  }
};

const clearSelection = () => setSelection(null);

const getSelectionBounds = () => selection ? { ...selection } : null;

const setClipboardData = (data) => {
  clipboardData = data ? JSON.parse(JSON.stringify(data)) : null;
  if (typeof refreshClipboardButtons === "function") {
    refreshClipboardButtons();
  }
};

const getClipboardData = () => clipboardData ? JSON.parse(JSON.stringify(clipboardData)) : null;

const hasClipboardData = () => !!clipboardData;

const startKeyboardSelection = () => {
  if (keyboardSelectionAnchor) return;
  if (selection && selection.block === cur.block) {
    keyboardSelectionAnchor = {
      block: selection.block,
      stringIdx: selection.startString,
      col: selection.startCol
    };
  } else {
    keyboardSelectionAnchor = { block: cur.block, stringIdx: cur.stringIdx, col: cur.col };
  }
};

const updateKeyboardSelection = () => {
  if (!keyboardSelectionAnchor) return;
  if (keyboardSelectionAnchor.block !== cur.block) {
    keyboardSelectionAnchor = { block: cur.block, stringIdx: cur.stringIdx, col: cur.col };
    setSelection(null);
    return;
  }
  setSelection({
    block: cur.block,
    startString: keyboardSelectionAnchor.stringIdx,
    endString: cur.stringIdx,
    startCol: keyboardSelectionAnchor.col,
    endCol: cur.col
  });
};

// Utility Functions
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const ensureAtLeastOneBlock = () => {
  if (blocks.length === 0) blocks.push(makeEmptyBlock(lineLength));
};

const isTabBlock = (block) => block && block.type === 'tab';
const isTextBlock = (block) => block && block.type === 'text';

// Block Creation
const makeEmptyBlock = (L) => {
  const b = [];
  for (let i = 0; i < 6; i++) {
    b.push(new Array(L).fill("-"));
  }
  return { type: 'tab', data: b };
};

const makeTextBlock = () => {
  return { type: 'text', data: '' };
};

// Undo System
const saveUndoState = () => {
  if (isUndoing) return; // Don't save state during undo operations
  
  // Deep clone the current state
  const state = {
    blocks: JSON.parse(JSON.stringify(blocks)),
    cur: { ...cur },
    editMode: editMode,
    lineLength: lineLength
  };
  
  undoStack.push(state);
  
  // Limit undo stack size
  if (undoStack.length > maxUndoSteps) {
    undoStack.shift(); // Remove oldest state
  }
};

const undo = () => {
  if (undoStack.length === 0) return;
  
  isUndoing = true;
  
  // Restore the last saved state
  const state = undoStack.pop();
  blocks = state.blocks;
  cur = state.cur;
  editMode = state.editMode;
  lineLength = state.lineLength;
  
  // Update UI to reflect restored state
  const modeBtn = document.getElementById("btn-mode-toggle");
  if (editMode === 'shift') {
    modeBtn.textContent = "Shift";
    modeBtn.classList.remove('insert-mode');
    modeBtn.classList.add('shift-mode');
  } else if (editMode === 'insert') {
    modeBtn.textContent = "Insert";
    modeBtn.classList.remove('shift-mode');
    modeBtn.classList.add('insert-mode');
  } else {
    modeBtn.textContent = "Replace";
    modeBtn.classList.remove('insert-mode', 'shift-mode');
  }
  
  document.getElementById("inp-len").value = String(lineLength);
  
  render();
  save();
  clearSelection();
  
  isUndoing = false;
};

// Cursor Management
const setCursor = (blockIdx, stringIdx, col) => {
  cur.block = clamp(blockIdx, 0, blocks.length - 1);
  cur.stringIdx = clamp(stringIdx, 0, 5);
  cur.col = clamp(col, 0, lineLength - 1);
  updateCursorOnly();
  if (typeof refreshClipboardButtons === "function") {
    refreshClipboardButtons();
  }
  if (typeof hideNoteTooltip === "function") {
    hideNoteTooltip();
  }
};

const moveCursor = (dBlock, dString, dCol) => {
  setCursor(cur.block + dBlock, cur.stringIdx + dString, cur.col + dCol);
};
