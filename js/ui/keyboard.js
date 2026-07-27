// Global keydown router for the tab grid.

import { emit } from "../core/bus.js";
import {
  isTabBlock,
  getDockedTextBeforeTab,
  findPreviousTabBlock,
  findNextTabBlock,
} from "../core/model.js";
import {
  state,
  setCursor,
  moveCursor,
  clearSelection,
  getSelectionBounds,
  hasClipboardData,
  startKeyboardSelection,
  updateKeyboardSelection,
  resetKeyboardSelectionAnchor,
  undo,
  cycleEditMode,
  saveUndoState,
} from "../core/store.js";
import {
  handlePrintable,
  insertBarAtCursor,
  deleteSelectionOrChar,
  clearSelectionOrChar,
  clearVerticalBar,
  copySelectionFromBlock,
  pasteClipboardIntoBlock,
  smartDeleteCharacter,
} from "../core/editing.js";
import { hideNoteTooltip } from "./tooltip.js";
import { focusDockedTextLine } from "./editor-view.js";
import { consumeArrowSuppression } from "./navigation.js";
import { isPerformActive } from "./perform.js";
import { handleListeningKey, isListeningActive } from "./listen.js";
import { isAnyDialogOpen } from "./dom.js";

const isPrintable = (e) => {
  if (e.ctrlKey || e.metaKey) return false;
  return e.key.length === 1;
};

const onKeyDown = (e) => {
  // Perform mode has its own handler.
  if (isPerformActive()) return;
  if (isAnyDialogOpen()) return;
  if (isListeningActive()) {
    if (handleListeningKey(e)) return;
    if (e.target?.closest?.("#listen-popover")) return;
  }

  if (consumeArrowSuppression() && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    return;
  }

  // Textareas (text blocks, text dialog) handle their own input.
  if (
    document.activeElement &&
    (document.activeElement.classList.contains("text-content") ||
      document.activeElement.classList.contains("text-modal-area"))
  ) {
    return;
  }

  if (isPrintable(e)) {
    e.preventDefault();
    hideNoteTooltip();
    handlePrintable(e.key, e.shiftKey);
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "z") {
    e.preventDefault();
    undo();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "c") {
    if (isTabBlock(state.blocks[state.cur.block])) {
      const bounds = getSelectionBounds();
      if (bounds && bounds.block === state.cur.block) {
        e.preventDefault();
        copySelectionFromBlock(state.cur.block);
      }
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "x") {
    if (isTabBlock(state.blocks[state.cur.block])) {
      const bounds = getSelectionBounds();
      if (bounds && bounds.block === state.cur.block) {
        e.preventDefault();
        copySelectionFromBlock(state.cur.block);
        clearSelectionOrChar(state.cur.block);
      }
    }
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key === "v") {
    if (isTabBlock(state.blocks[state.cur.block]) && hasClipboardData()) {
      e.preventDefault();
      pasteClipboardIntoBlock(state.cur.block);
    }
    return;
  }

  const handleDirectionalMove = (dBlock, dString, dCol) => {
    if (e.shiftKey && isTabBlock(state.blocks[state.cur.block])) {
      e.preventDefault();
      startKeyboardSelection();
      moveCursor(dBlock, dString, dCol);
      updateKeyboardSelection();
      hideNoteTooltip();
      return;
    }

    e.preventDefault();
    clearSelection();
    resetKeyboardSelectionAnchor();

    const { cur, blocks, lineLength } = state;

    if (!isTabBlock(blocks[cur.block])) {
      moveCursor(dBlock, dString, dCol);
      hideNoteTooltip();
      return;
    }

    // Up from the top string enters a docked text line, if any.
    if (dString === -1 && cur.stringIdx === 0) {
      const dockedTextIdx = getDockedTextBeforeTab(blocks, cur.block);
      if (dockedTextIdx !== -1) {
        focusDockedTextLine(dockedTextIdx, cur.col);
        return;
      }
    }

    // At the block edges, hop into the neighboring tab block.
    if (dCol === 1 && cur.col === lineLength - 1) {
      const next = findNextTabBlock(blocks, cur.block);
      if (next !== -1) {
        setCursor(next, cur.stringIdx, 0);
        return;
      }
    }
    if (dCol === -1 && cur.col === 0) {
      const prev = findPreviousTabBlock(blocks, cur.block);
      if (prev !== -1) {
        setCursor(prev, cur.stringIdx, lineLength - 1);
        return;
      }
    }
    if (dString === -1 && cur.stringIdx === 0) {
      const prev = findPreviousTabBlock(blocks, cur.block);
      if (prev !== -1) {
        setCursor(prev, 5, cur.col);
        return;
      }
    }
    if (dString === 1 && cur.stringIdx === 5) {
      const next = findNextTabBlock(blocks, cur.block);
      if (next !== -1) {
        setCursor(next, 0, cur.col);
        return;
      }
    }

    moveCursor(dBlock, dString, dCol);
    hideNoteTooltip();
  };

  switch (e.key) {
    case "ArrowLeft": handleDirectionalMove(0, 0, -1); break;
    case "ArrowRight": handleDirectionalMove(0, 0, +1); break;
    case "ArrowUp": handleDirectionalMove(0, -1, 0); break;
    case "ArrowDown": handleDirectionalMove(0, +1, 0); break;
    case "Tab":
      e.preventDefault();
      hideNoteTooltip();
      cycleEditMode();
      break;
    case "Backspace": {
      e.preventDefault();
      hideNoteTooltip();
      const { cur, blocks, editMode } = state;
      if (!isTabBlock(blocks[cur.block])) break;
      const bounds = getSelectionBounds();
      const hasSelection = bounds && bounds.block === cur.block;

      if (editMode === "shift") {
        if (hasSelection) {
          deleteSelectionOrChar(cur.block);
        } else if (cur.col > 0) {
          setCursor(cur.block, cur.stringIdx, cur.col - 1);
          deleteSelectionOrChar(cur.block, { allStrings: true, targetRow: cur.stringIdx });
        }
      } else if (editMode === "insert") {
        if (hasSelection) {
          deleteSelectionOrChar(cur.block);
        } else if (cur.col > 0) {
          setCursor(cur.block, cur.stringIdx, cur.col - 1);
          smartDeleteCharacter("backward", e.shiftKey);
        }
      } else {
        // Replace mode: blank the current cell, step left.
        if (hasSelection) {
          clearSelectionOrChar(cur.block);
        } else {
          saveUndoState();
          if (blocks[cur.block].data[cur.stringIdx][cur.col] === "|") {
            clearVerticalBar(cur.block, cur.col);
          } else {
            blocks[cur.block].data[cur.stringIdx][cur.col] = "-";
          }
          emit("cells-changed", { block: cur.block });
          emit("dirty");
        }
        setCursor(cur.block, cur.stringIdx, Math.max(0, cur.col - 1));
      }
      break;
    }
    case "Delete": {
      e.preventDefault();
      hideNoteTooltip();
      const { cur, blocks, editMode } = state;
      if (!isTabBlock(blocks[cur.block])) break;
      const bounds = getSelectionBounds();
      const hasSelection = bounds && bounds.block === cur.block;

      if (editMode === "shift" && !hasSelection) {
        deleteSelectionOrChar(cur.block, { allStrings: true, targetRow: cur.stringIdx });
      } else if (editMode === "insert" && !hasSelection) {
        smartDeleteCharacter("forward", e.shiftKey);
      } else {
        deleteSelectionOrChar(cur.block);
      }
      break;
    }
    case "Home":
      e.preventDefault();
      setCursor(state.cur.block, state.cur.stringIdx, 0);
      hideNoteTooltip();
      break;
    case "End":
      e.preventDefault();
      setCursor(state.cur.block, state.cur.stringIdx, state.lineLength - 1);
      hideNoteTooltip();
      break;
    case "Insert":
      e.preventDefault();
      cycleEditMode();
      break;
    case "Enter":
      // Quick annotate: insert a bar, drop to the next string.
      e.preventDefault();
      insertBarAtCursor();
      moveCursor(0, +1, 0);
      break;
  }
};

export const initKeyboard = () => {
  document.addEventListener("keydown", onKeyDown);
};
