// Rectangular selection: drag gestures (mouse immediately, touch after a
// long-press), highlight classes on cells, and clipboard-button visibility.

import { on } from "../core/bus.js";
import { isTabBlock } from "../core/model.js";
import {
  state,
  setCursor,
  setSelection,
  clearSelection,
  hasClipboardData,
} from "../core/store.js";
import { $ } from "./dom.js";

const drag = {
  active: false,
  pending: false,
  timer: null,
  block: null,
  anchor: null,
  pointerType: null,
  touchId: null,
};

const SELECTION_CLASSES = [
  "sel", "sel-top", "sel-bottom", "sel-left", "sel-right",
  "sel-corner-tl", "sel-corner-tr", "sel-corner-bl", "sel-corner-br",
];
const SELECTION_SELECTOR = SELECTION_CLASSES.map((cls) => `.ch.${cls}`).join(", ");

const getCell = (blockIdx, stringIdx, col) => {
  const blockEl = $("editor")?.children[blockIdx];
  if (!blockEl) return null;
  const lineEl = blockEl.querySelectorAll(".line")[stringIdx];
  const charsContainer = lineEl?.querySelector(".chars");
  return charsContainer?.children[col] ?? null;
};

const highlightCell = (blockIdx, stringIdx, col, meta) => {
  const cell = getCell(blockIdx, stringIdx, col);
  if (!cell) return;
  cell.classList.add("sel");
  if (meta.top) cell.classList.add("sel-top");
  if (meta.bottom) cell.classList.add("sel-bottom");
  if (meta.left) cell.classList.add("sel-left");
  if (meta.right) cell.classList.add("sel-right");
  if (meta.top && meta.left) cell.classList.add("sel-corner-tl");
  if (meta.top && meta.right) cell.classList.add("sel-corner-tr");
  if (meta.bottom && meta.left) cell.classList.add("sel-corner-bl");
  if (meta.bottom && meta.right) cell.classList.add("sel-corner-br");
};

export const updateSelectionHighlight = () => {
  document.querySelectorAll(SELECTION_SELECTOR).forEach((el) => {
    el.classList.remove(...SELECTION_CLASSES);
  });
  const sel = state.selection;
  if (!sel || sel.block == null) {
    refreshClipboardButtons();
    return;
  }
  for (let stringIdx = sel.startString; stringIdx <= sel.endString; stringIdx++) {
    for (let col = sel.startCol; col <= sel.endCol; col++) {
      highlightCell(sel.block, stringIdx, col, {
        top: stringIdx === sel.startString,
        bottom: stringIdx === sel.endString,
        left: col === sel.startCol,
        right: col === sel.endCol,
      });
    }
  }
  refreshClipboardButtons();
};

// Per-block copy/paste/clear/delete buttons only show when applicable.
export const refreshClipboardButtons = () => {
  document.querySelectorAll(".clipboard-btn").forEach((btn) => {
    const block = parseInt(btn.dataset.block, 10);
    const blockData = state.blocks[block];
    if (Number.isNaN(block) || !isTabBlock(blockData)) {
      btn.classList.add("is-hidden");
      return;
    }
    const sel = state.selection;
    let visible = false;
    switch (btn.dataset.role) {
      case "copy": visible = !!sel && sel.block === block; break;
      case "paste": visible = state.cur.block === block && hasClipboardData(); break;
      case "clear": visible = state.cur.block === block; break;
      case "delete": visible = state.cur.block === block; break;
    }
    btn.classList.toggle("is-hidden", !visible);
  });
};

// --- Drag gestures ---

export const cancelSelectionTimer = () => {
  if (drag.timer) {
    clearTimeout(drag.timer);
    drag.timer = null;
  }
  if (!drag.active) drag.touchId = null;
};

const activateSelectionFromAnchor = () => {
  if (!drag.anchor || drag.block == null) return;
  drag.pending = false;
  drag.active = true;
  const { stringIdx, col } = drag.anchor;
  setSelection({ block: drag.block, startString: stringIdx, endString: stringIdx, startCol: col, endCol: col });
};

const startSelectionGesture = (blockIdx, stringIdx, col, pointerType, opts = {}) => {
  const immediate = opts.immediate !== false;
  drag.pointerType = pointerType;
  drag.block = blockIdx;
  drag.anchor = { stringIdx, col };
  drag.pending = !immediate;
  drag.active = immediate;
  setCursor(blockIdx, stringIdx, col);
  if (immediate) {
    setSelection({ block: blockIdx, startString: stringIdx, endString: stringIdx, startCol: col, endCol: col });
  }
};

const updateSelectionFromCell = (blockIdx, stringIdx, col) => {
  if (!drag.active || drag.block !== blockIdx || !drag.anchor) return;
  setSelection({
    block: blockIdx,
    startString: drag.anchor.stringIdx,
    endString: stringIdx,
    startCol: drag.anchor.col,
    endCol: col,
  });
  setCursor(blockIdx, stringIdx, col);
};

const handleSelectionPointerMove = (clientX, clientY, pointerType) => {
  if ((!drag.active && !drag.pending) || drag.pointerType !== pointerType) return;
  const cell = document.elementFromPoint(clientX, clientY)?.closest(".ch");
  if (!cell) return;
  const blockIdx = parseInt(cell.dataset.block, 10);
  const stringIdx = parseInt(cell.dataset.string, 10);
  const col = parseInt(cell.dataset.col, 10);
  if ([blockIdx, stringIdx, col].some(Number.isNaN)) return;
  if (blockIdx !== drag.block) return;
  if (drag.pending) activateSelectionFromAnchor();
  updateSelectionFromCell(blockIdx, stringIdx, col);
};

export const endSelectionGesture = (pointerType, force = false) => {
  if (!drag.active && !drag.timer) {
    drag.pending = false;
    drag.pointerType = null;
    drag.block = null;
    drag.anchor = null;
    drag.touchId = null;
    return;
  }
  if (!force && drag.pointerType && pointerType && drag.pointerType !== pointerType) {
    return;
  }
  cancelSelectionTimer();
  drag.active = false;
  drag.pending = false;
  drag.pointerType = null;
  drag.block = null;
  drag.anchor = null;
  drag.touchId = null;
};

// Mouse selection starts armed (pending) and activates on first drag move.
export const handleCellMouseDown = (blockIdx, stringIdx, col, event) => {
  if (event.button !== 0) return;
  endSelectionGesture("mouse", true);
  cancelSelectionTimer();
  startSelectionGesture(blockIdx, stringIdx, col, "mouse", { immediate: false });
  clearSelection();
};

// Touch selection starts after a 300ms hold (plain taps just move the cursor).
export const handleCellTouchStart = (blockIdx, stringIdx, col, event) => {
  if (event.touches.length > 1) return;
  endSelectionGesture("touch", true);
  cancelSelectionTimer();
  const touch = event.changedTouches[0];
  drag.timer = setTimeout(() => {
    cancelSelectionTimer();
    drag.touchId = touch.identifier;
    startSelectionGesture(blockIdx, stringIdx, col, "touch");
  }, 300);
};

const handleTouchMoveSelection = (e) => {
  if (drag.timer && !drag.active) {
    cancelSelectionTimer();
    return;
  }
  if (!drag.active || drag.pointerType !== "touch") return;
  const touch = Array.from(e.touches).find(
    (t) => drag.touchId == null || t.identifier === drag.touchId
  );
  if (!touch) return;
  drag.touchId = touch.identifier;
  e.preventDefault();
  handleSelectionPointerMove(touch.clientX, touch.clientY, "touch");
};

export const initSelection = () => {
  document.addEventListener("mousemove", (e) => handleSelectionPointerMove(e.clientX, e.clientY, "mouse"));
  document.addEventListener("mouseup", () => endSelectionGesture("mouse"));
  document.addEventListener("touchmove", handleTouchMoveSelection, { passive: false });
  document.addEventListener("touchend", () => endSelectionGesture("touch"));
  document.addEventListener("touchcancel", () => endSelectionGesture("touch"));

  // Clicking outside the grid clears the selection.
  document.addEventListener("mousedown", (e) => {
    if (!state.selection) return;
    if (
      e.target.closest(".ch") ||
      e.target.closest(".clipboard-btn") ||
      e.target.closest(".block-btn") ||
      e.target.closest(".block-remove-handle")
    ) {
      return;
    }
    clearSelection();
  });

  on("selection-changed", updateSelectionHighlight);
  on("clipboard-changed", refreshClipboardButtons);
};
