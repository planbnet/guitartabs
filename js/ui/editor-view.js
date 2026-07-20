// Editor view: builds the block DOM and keeps it in sync with state.
//
// Rendering is tiered so typing stays cheap:
//   cells-changed      → syncBlockCells(i): update changed cell text only
//   cursor-changed     → class toggle on the cursor cell
//   selection-changed  → class toggles (ui/selection.js)
//   structure/document/linelength changes → renderAll() full rebuild
//
// All cell/button events are delegated from the #editor container, so a
// rebuild never re-attaches per-cell listeners. Only textarea listeners are
// per-block (attached at build time; blocks rebuild on structure changes only).

import { TUNINGS, STRING_COUNT } from "../core/constants.js";
import { on, emit } from "../core/bus.js";
import {
  clamp,
  isTabBlock,
  isTextBlock,
  isDockedTextBlock,
  getDockedTabForText,
  findPreviousTabBlock,
  getFretNumberInRow,
} from "../core/model.js";
import { state, setCursor, clearSelection, resetKeyboardSelectionAnchor, saveUndoState } from "../core/store.js";
import {
  deleteBlock,
  moveBlock,
  insertBarColumnAt,
  deleteSelectionOrChar,
  clearSelectionOrChar,
  copySelectionFromBlock,
  pasteClipboardIntoBlock,
} from "../core/editing.js";
import { getSelectionBounds } from "../core/store.js";
import { $, focusKeyboard } from "./dom.js";
import {
  renderDockedTextDisplay,
  showChordPopup,
  hideChordPopup,
  textColumnToTabColumn,
  tabColumnToTextColumn,
  DOCKED_TEXT_COLUMN_OFFSET,
} from "./chords.js";
import { showNoteTooltip, hideNoteTooltip } from "./tooltip.js";
import {
  handleCellMouseDown,
  handleCellTouchStart,
  updateSelectionHighlight,
  refreshClipboardButtons,
} from "./selection.js";
import { suppressNextArrowKeyNavigation } from "./navigation.js";

const editor = () => $("editor");

// --- Character width measurement (docked-text click → column mapping) ---

const charWidthCache = new Map();
const getCharWidthForElement = (el) => {
  if (!el) return 9.6;
  const styles = window.getComputedStyle(el);
  const key = [styles.fontFamily, styles.fontSize, styles.fontWeight, styles.fontStyle, styles.letterSpacing].join("|");
  if (charWidthCache.has(key)) return charWidthCache.get(key);
  const probe = document.createElement("span");
  probe.textContent = "0";
  probe.className = "char-width-probe";
  probe.style.fontFamily = styles.fontFamily;
  probe.style.fontSize = styles.fontSize;
  probe.style.fontWeight = styles.fontWeight;
  probe.style.fontStyle = styles.fontStyle;
  probe.style.letterSpacing = styles.letterSpacing;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width || 9.6;
  probe.remove();
  charWidthCache.set(key, width);
  return width;
};

// --- Docked text focus handling ---

// Pad a docked line with spaces so the caret can land at the target column.
const ensureDockedTextWidth = (blockIdx, textCol) => {
  const block = state.blocks[blockIdx];
  if (!block || !isTextBlock(block) || block.data.includes("\n")) return;
  const requiredLength = Math.max(textCol, block.data.length);
  if (block.data.length >= requiredLength) return;
  saveUndoState();
  block.data = block.data.padEnd(requiredLength, " ");
  const textArea = document.querySelector(`textarea[data-block="${blockIdx}"]`);
  if (textArea) {
    const scrollTop = textArea.scrollTop;
    textArea.value = block.data;
    textArea.scrollTop = scrollTop;
  }
  emit("dirty");
};

export const focusDockedTextLine = (blockIdx, col) => {
  const textCol = tabColumnToTextColumn(col);
  ensureDockedTextWidth(blockIdx, textCol);

  editor()?.children[blockIdx]?.classList.add("editing");

  const textArea = document.querySelector(`textarea[data-block="${blockIdx}"]`);
  const targetTextCol = Math.min(textCol, state.lineLength - 1 + DOCKED_TEXT_COLUMN_OFFSET);
  if (textArea) {
    textArea.focus();
    const pos = Math.min(targetTextCol, textArea.value.length);
    textArea.setSelectionRange(pos, pos);
  }
  state.cur.block = blockIdx;
  state.cur.stringIdx = 0;
  state.cur.col = clamp(col, 0, state.lineLength - 1);
  updateCursorOnly();
  hideNoteTooltip();
};

export const focusTabFromDockedText = (textIdx, col, direction) => {
  const tabCol = textColumnToTabColumn(col);
  if (direction === "down") {
    const tabIdx = getDockedTabForText(state.blocks, textIdx);
    if (tabIdx !== -1) {
      setCursor(tabIdx, 0, tabCol);
      focusKeyboard();
    }
  } else if (direction === "up") {
    const prevTabIdx = findPreviousTabBlock(state.blocks, textIdx);
    if (prevTabIdx !== -1) {
      setCursor(prevTabIdx, 5, tabCol);
      focusKeyboard();
    }
  }
};

// --- Cursor ---

export const updateCursorOnly = () => {
  const el = editor();
  if (!el) return;

  document.querySelectorAll(".ch.cursor").forEach((c) => c.classList.remove("cursor"));

  const blockEl = el.children[state.cur.block];
  if (!blockEl || !isTabBlock(state.blocks[state.cur.block])) return;

  const stringEl = blockEl.querySelectorAll(".line")[state.cur.stringIdx];
  const cell = stringEl?.querySelector(".chars")?.children[state.cur.col];
  cell?.classList.add("cursor");
};

// --- Incremental cell sync ---

const syncBlockCells = ({ block: blockIdx }) => {
  const el = editor();
  const block = state.blocks[blockIdx];
  const blockEl = el?.children[blockIdx];
  if (!el || !blockEl || !isTabBlock(block)) {
    renderAll();
    return;
  }

  const lines = blockEl.querySelectorAll(".line");
  if (lines.length !== STRING_COUNT) {
    renderAll();
    return;
  }

  for (let stringIdx = 0; stringIdx < STRING_COUNT; stringIdx++) {
    const cells = lines[stringIdx].querySelector(".chars")?.children;
    const row = block.data[stringIdx];
    if (!cells || cells.length !== row.length) {
      renderAll();
      return;
    }
    for (let col = 0; col < row.length; col++) {
      if (cells[col].textContent !== row[col]) {
        cells[col].textContent = row[col];
      }
    }
  }
};

// --- Block builders (no per-cell listeners; everything is delegated) ---

const makeControlButton = ({ action, blockIdx, text, title, className, disabled, role }) => {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  btn.className = className;
  if (title) btn.title = title;
  btn.disabled = !!disabled;
  btn.dataset.action = action;
  btn.dataset.block = String(blockIdx);
  if (role) btn.dataset.role = role;
  return btn;
};

const buildTabBlock = (blockEl, block, bi) => {
  blockEl.classList.add("tab-block");
  if (isDockedTextBlock(state.blocks, bi - 1)) {
    blockEl.classList.add("has-docked-text");
  }

  const controls = document.createElement("div");
  controls.className = "block-controls";
  controls.append(
    makeControlButton({ action: "move-up", blockIdx: bi, text: "↑", title: "Move up", className: "block-btn block-btn-equal", disabled: bi === 0 }),
    makeControlButton({ action: "delete-sel", blockIdx: bi, text: "✖", title: "Delete selection or current cell", className: "block-btn block-btn-equal clipboard-btn", role: "delete" }),
    makeControlButton({ action: "clear-sel", blockIdx: bi, text: "—", title: "Clear selection or current cell", className: "block-btn block-btn-equal clipboard-btn", role: "clear" }),
    makeControlButton({ action: "paste", blockIdx: bi, text: "P", title: "Paste", className: "block-btn block-btn-equal clipboard-btn", role: "paste" }),
    makeControlButton({ action: "copy", blockIdx: bi, text: "C", title: "Copy selection", className: "block-btn block-btn-equal clipboard-btn", role: "copy" }),
    makeControlButton({ action: "move-down", blockIdx: bi, text: "↓", title: "Move down", className: "block-btn block-btn-equal block-btn-bottom", disabled: bi === state.blocks.length - 1 })
  );
  blockEl.appendChild(controls);

  for (let stringIdx = 0; stringIdx < STRING_COUNT; stringIdx++) {
    const stringEl = document.createElement("div");
    stringEl.className = "line";
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = `${TUNINGS[stringIdx]}|`;
    stringEl.appendChild(label);

    const charsContainer = document.createElement("div");
    charsContainer.className = "chars";
    const row = block.data[stringIdx];
    for (let col = 0; col < row.length; col++) {
      const s = document.createElement("span");
      s.className = "ch";
      s.dataset.block = String(bi);
      s.dataset.string = String(stringIdx);
      s.dataset.col = String(col);
      s.textContent = row[col];
      charsContainer.appendChild(s);
    }
    stringEl.appendChild(charsContainer);
    blockEl.appendChild(stringEl);
  }
};

const buildTextBlock = (blockEl, block, bi) => {
  blockEl.classList.add("text-block");
  const isDocked = isDockedTextBlock(state.blocks, bi);
  if (isDocked) blockEl.classList.add("docked-text");

  if (state.blocks.length > 1) {
    const controls = document.createElement("div");
    controls.className = "block-controls";
    if (isDocked) controls.classList.add("block-controls-docked");
    controls.append(
      makeControlButton({ action: "move-up", blockIdx: bi, text: "↑", title: "Move up", className: "block-btn", disabled: bi === 0 }),
      makeControlButton({ action: "move-down", blockIdx: bi, text: "↓", title: "Move down", className: "block-btn" + (isDocked ? "" : " block-btn-bottom"), disabled: bi === state.blocks.length - 1 })
    );
    blockEl.appendChild(controls);
  }

  const textArea = document.createElement("textarea");
  textArea.className = "text-content";
  textArea.value = block.data;
  textArea.rows = 1;
  if (isDocked) {
    textArea.placeholder = "Add a line break to detach this line from the next tab line";
  }
  textArea.setAttribute("spellcheck", "false");
  textArea.setAttribute("autocomplete", "off");
  textArea.setAttribute("autocorrect", "off");
  textArea.setAttribute("autocapitalize", "off");
  textArea.dataset.block = String(bi);

  const displayDiv = document.createElement("div");
  displayDiv.className = "docked-text-display";
  displayDiv.dataset.block = String(bi);
  displayDiv.innerHTML = renderDockedTextDisplay(block.data, bi);

  textArea.addEventListener("blur", () => {
    displayDiv.innerHTML = renderDockedTextDisplay(textArea.value, bi);
    setTimeout(() => {
      if (document.activeElement === textArea) return;
      blockEl.classList.remove("editing");
    }, 100);
  });

  if (state.cur.block === bi) blockEl.classList.add("editing");

  blockEl.appendChild(displayDiv);

  const autoResize = () => {
    if (isDocked) {
      textArea.style.height = "";
      return;
    }
    textArea.style.height = "auto";
    const minHeight = block.data.includes("\n") ? 28 : 42;
    textArea.style.height = `${Math.max(minHeight, textArea.scrollHeight)}px`;
  };

  let textInputTimeout;
  let previousHadNewline = block.data.includes("\n");

  textArea.addEventListener("input", (e) => {
    state.blocks[bi].data = e.target.value;

    // Adding/removing the first newline flips the docking state.
    const currentHasNewline = e.target.value.includes("\n");
    if (currentHasNewline !== previousHadNewline) {
      previousHadNewline = currentHasNewline;
      emit("structure-changed");
      // Re-focus after the rebuild, restoring the caret.
      setTimeout(() => {
        const newTextArea = editor()?.children[bi]?.querySelector(".text-content");
        if (newTextArea) {
          newTextArea.focus();
          newTextArea.selectionStart = e.target.selectionStart;
          newTextArea.selectionEnd = e.target.selectionEnd;
        }
      }, 0);
    } else {
      autoResize();
    }

    emit("dirty");

    // Debounce undo snapshots while typing prose.
    clearTimeout(textInputTimeout);
    textInputTimeout = setTimeout(() => {
      if (!state.isUndoing) saveUndoState();
    }, 1000);
  });

  textArea.addEventListener("focus", () => {
    state.cur.block = bi;
    state.cur.stringIdx = 0;
    state.cur.col = 0;
    updateCursorOnly();
    emit("dirty");
  });

  textArea.addEventListener("click", (e) => {
    e.stopPropagation();
    textArea.focus();
  });

  textArea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      // Cycled from the toolbar module via the bus; import avoided here.
      emit("request-editmode-cycle");
      return;
    }

    if (!isDocked) return;

    if (e.key === "ArrowRight") {
      const caretStart = textArea.selectionStart ?? 0;
      const caretEnd = textArea.selectionEnd ?? caretStart;
      const valueLength = textArea.value.length;
      if (caretStart === valueLength && caretEnd === valueLength) {
        e.preventDefault();
        saveUndoState();
        state.blocks[bi].data = `${textArea.value} `;
        textArea.value = state.blocks[bi].data;
        textArea.setSelectionRange(valueLength + 1, valueLength + 1);
        emit("dirty");
      }
      return;
    }

    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

    const caretCol = textArea.selectionStart ?? 0;
    const direction = e.key === "ArrowDown" ? "down" : "up";
    const targetIdx = direction === "down"
      ? getDockedTabForText(state.blocks, bi)
      : findPreviousTabBlock(state.blocks, bi);
    if (targetIdx !== -1) {
      e.preventDefault();
      clearSelection();
      resetKeyboardSelectionAnchor();
      suppressNextArrowKeyNavigation();
      focusTabFromDockedText(bi, caretCol, direction);
    }
  });

  requestAnimationFrame(() => {
    autoResize();
    if (bi === state.cur.block) textArea.focus();
  });

  blockEl.appendChild(textArea);
};

// --- Full render ---

export const renderAll = () => {
  const el = editor();
  if (!el) return;

  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;

  el.innerHTML = "";
  el.style.setProperty("--line-length", state.lineLength);

  state.blocks.forEach((block, bi) => {
    const blockEl = document.createElement("div");
    blockEl.className = "block";
    blockEl.dataset.block = String(bi);

    if (isTabBlock(block)) {
      buildTabBlock(blockEl, block, bi);
    } else if (isTextBlock(block)) {
      buildTextBlock(blockEl, block, bi);
    }

    const removeBtn = makeControlButton({
      action: "remove-block",
      blockIdx: bi,
      text: "×",
      title: "Delete block",
      className: "block-remove-handle",
    });
    if (state.blocks.length === 1) removeBtn.classList.add("is-hidden");
    blockEl.appendChild(removeBtn);

    el.appendChild(blockEl);
  });

  requestAnimationFrame(() => window.scrollTo(previousScrollX, previousScrollY));

  updateCursorOnly();
  updateSelectionHighlight();
  refreshClipboardButtons();
};

// --- Delegated events ---

const cellFromEvent = (e) => {
  const cell = e.target.closest(".ch");
  if (!cell) return null;
  const blockIdx = parseInt(cell.dataset.block, 10);
  const stringIdx = parseInt(cell.dataset.string, 10);
  const col = parseInt(cell.dataset.col, 10);
  if ([blockIdx, stringIdx, col].some(Number.isNaN)) return null;
  return { cell, blockIdx, stringIdx, col };
};

const handleActionClick = (btn) => {
  const action = btn.dataset.action;
  const bi = parseInt(btn.dataset.block, 10);
  if (Number.isNaN(bi)) return false;

  switch (action) {
    case "move-up": moveBlock(bi, -1); return true;
    case "move-down": moveBlock(bi, 1); return true;
    case "remove-block": deleteBlock(bi); return true;
    case "copy": copySelectionFromBlock(bi); return true;
    case "paste": pasteClipboardIntoBlock(bi); return true;
    case "clear-sel": clearSelectionOrChar(bi); return true;
    case "delete-sel": {
      const bounds = getSelectionBounds();
      const hasSelection = bounds && bounds.block === bi;
      if (state.editMode === "shift" && !hasSelection) {
        deleteSelectionOrChar(bi, { allStrings: true, targetRow: state.cur.stringIdx });
      } else {
        deleteSelectionOrChar(bi);
      }
      return true;
    }
  }
  return false;
};

const handleDockedDisplayClick = (displayDiv, e) => {
  if (e.target.classList.contains("chord")) {
    showChordPopup(e.target, e.target.dataset.chord);
    return;
  }

  hideChordPopup();

  const bi = parseInt(displayDiv.dataset.block, 10);
  if (Number.isNaN(bi)) return;

  const rect = displayDiv.getBoundingClientRect();
  const x = Math.max(0, e.clientX - rect.left);
  const charWidth = getCharWidthForElement(displayDiv) || 9.6;
  const rawCol = Math.floor(x / charWidth);
  const maxTextCol = state.lineLength - 1 + DOCKED_TEXT_COLUMN_OFFSET;
  const textCol = clamp(rawCol, 0, maxTextCol);
  focusDockedTextLine(bi, textColumnToTabColumn(textCol));
};

const initDelegatedEvents = () => {
  const el = editor();

  el.addEventListener("click", (e) => {
    const actionBtn = e.target.closest("[data-action]");
    if (actionBtn && el.contains(actionBtn)) {
      e.stopPropagation();
      handleActionClick(actionBtn);
      return;
    }

    const displayDiv = e.target.closest(".docked-text-display");
    if (displayDiv) {
      e.stopPropagation();
      handleDockedDisplayClick(displayDiv, e);
      return;
    }

    const hit = cellFromEvent(e);
    if (hit) {
      e.stopPropagation();
      hideChordPopup();
      setCursor(hit.blockIdx, hit.stringIdx, hit.col);
      focusKeyboard();

      const block = state.blocks[hit.blockIdx];
      const fret = isTabBlock(block)
        ? getFretNumberInRow(block.data[hit.stringIdx], hit.col)
        : null;
      if (fret !== null) {
        showNoteTooltip(hit.cell, hit.stringIdx, fret);
      } else {
        hideNoteTooltip();
      }
    }
  });

  el.addEventListener("dblclick", (e) => {
    const hit = cellFromEvent(e);
    if (!hit) return;
    e.stopPropagation();
    insertBarColumnAt(hit.blockIdx, hit.col);
    setCursor(hit.blockIdx, hit.stringIdx, hit.col);
    focusKeyboard();
  });

  el.addEventListener("mousedown", (e) => {
    const hit = cellFromEvent(e);
    if (!hit) return;
    handleCellMouseDown(hit.blockIdx, hit.stringIdx, hit.col, e);
    hideChordPopup();
  });

  el.addEventListener("touchstart", (e) => {
    const hit = cellFromEvent(e);
    if (!hit) return;
    handleCellTouchStart(hit.blockIdx, hit.stringIdx, hit.col, e);
  }, { passive: true });
};

export const initEditorView = () => {
  initDelegatedEvents();
  on("cells-changed", syncBlockCells);
  on("structure-changed", renderAll);
  on("document-replaced", renderAll);
  on("linelength-changed", renderAll);
  on("cursor-changed", updateCursorOnly);
};
