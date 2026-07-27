// Chord recognition in docked text lines, the chord diagram popup, and
// inserting a chord's fingering into the docked tab block.

import { vexchords, CHORDS_DB } from "../vendor/globals.js";
import { emit } from "../core/bus.js";
import {
  clamp,
  isTabBlock,
  getDockedTabForText,
} from "../core/model.js";
import {
  state,
  setCursor,
  clearSelection,
  saveUndoState,
} from "../core/store.js";
import { shiftBlockForInsert } from "../core/editing.js";
import { formatChordPositionForTab } from "../core/fretboard.js";
import { $, escapeHtml, focusKeyboard } from "./dom.js";

export const CHORD_REGEX = /\b([A-G](?:#|b)?(?:m|maj|min|dim|aug|sus)?(?:\d{0,2})(?:(?:b|#)\d+)?(?:(?:add|sus)\d+)?(?:(?:\/|\\)[A-G](?:#|b)?)?)\b/g;

// Docked text lines are offset two columns from the grid ("e|" prefix width).
export const DOCKED_TEXT_COLUMN_OFFSET = 2;

export const textColumnToTabColumn = (col) =>
  clamp(Math.max(col - DOCKED_TEXT_COLUMN_OFFSET, 0), 0, state.lineLength - 1);

export const tabColumnToTextColumn = (col) =>
  clamp(col, 0, state.lineLength - 1) + DOCKED_TEXT_COLUMN_OFFSET;

// Markup for a docked text line with chord names wrapped in clickable spans.
export const renderDockedTextDisplay = (text, blockIdx = null) => {
  let lastIndex = 0;
  let out = "";

  text.replace(CHORD_REGEX, (match, chordName, offset) => {
    out += escapeHtml(text.slice(lastIndex, offset));
    const blockAttr = Number.isInteger(blockIdx) ? ` data-block="${blockIdx}"` : "";
    out += `<span class="chord"${blockAttr} data-text-col="${offset}" data-chord="${chordName}">${escapeHtml(match)}</span>`;
    lastIndex = offset + match.length;
    return match;
  });

  out += escapeHtml(text.slice(lastIndex));
  return out;
};

// --- Popup state ---

let activeChordElement = null;
let currentChordPositions = [];
let currentChordPositionIndex = 0;

const chordPopup = () => $("chord-popup");

export const findChordData = (chordName) => {
  if (!CHORDS_DB) return null;

  // Longest key first so "C#" wins over "C".
  const sortedKeys = [...CHORDS_DB.keys].sort((a, b) => b.length - a.length);
  let key = null;
  let suffix = null;
  for (const k of sortedKeys) {
    if (chordName.startsWith(k)) {
      key = k;
      suffix = chordName.slice(k.length);
      break;
    }
  }
  if (!key) return null;

  if (suffix === "" || suffix === "maj") suffix = "major";
  else if (suffix === "m" || suffix === "min") suffix = "minor";

  const chords = CHORDS_DB.chords[key];
  if (!chords) return null;
  const chord = chords.find((c) => c.suffix === suffix);
  return chord ? chord.positions : null;
};

const getActiveChordInsertContext = () => {
  if (!activeChordElement) return null;
  const blockAttr = activeChordElement.dataset.block;
  if (blockAttr == null) return null;
  const textBlockIdx = parseInt(blockAttr, 10);
  if (Number.isNaN(textBlockIdx)) return null;
  const tabBlockIdx = getDockedTabForText(state.blocks, textBlockIdx);
  if (tabBlockIdx === -1) return null;
  const textCol = parseInt(activeChordElement.dataset.textCol ?? "0", 10) || 0;
  return { textBlockIdx, tabBlockIdx, tabCol: textColumnToTabColumn(textCol) };
};

// chords-db position → per-string fret text, high e first (grid order).
const canInsertChordAtActivePosition = () =>
  currentChordPositions.length > 0 && !!getActiveChordInsertContext();

const insertActiveChordFingering = () => {
  const position = currentChordPositions[currentChordPositionIndex];
  if (!position) return;
  const context = getActiveChordInsertContext();
  if (!context) return;
  const chordData = formatChordPositionForTab(position);
  if (!chordData || chordData.width <= 0) return;
  const tabBlock = state.blocks[context.tabBlockIdx];
  if (!isTabBlock(tabBlock)) return;

  saveUndoState();
  clearSelection();

  const { lineLength } = state;
  const maxStart = Math.max(0, lineLength - chordData.width);
  const startCol = clamp(clamp(context.tabCol, 0, lineLength - 1), 0, maxStart);

  if (state.editMode === "replace") {
    for (let s = 0; s < 6; s++) {
      for (let c = 0; c < chordData.width && startCol + c < lineLength; c++) {
        tabBlock.data[s][startCol + c] = "-";
      }
    }
  } else {
    shiftBlockForInsert(tabBlock, startCol, chordData.width);
  }

  chordData.rows.forEach((value, stringIdx) => {
    const row = tabBlock.data[stringIdx];
    for (let i = 0; i < value.length && startCol + i < lineLength; i++) {
      row[startCol + i] = value[i];
    }
  });

  setCursor(context.tabBlockIdx, 0, startCol);
  emit("cells-changed", { block: context.tabBlockIdx });
  emit("dirty");
  focusKeyboard();
  hideChordPopup();
};

const renderChordDiagram = (container, position) => {
  container.innerHTML = "";
  if (!vexchords) {
    container.textContent = "vexchords library not loaded";
    return;
  }

  // chords-db index 0 is the low E string; vexchords counts 6 = low E.
  const chord = [];
  position.frets.forEach((fret, index) => {
    const string = 6 - index;
    if (fret === -1) chord.push([string, "x"]);
    else chord.push([string, fret]);
  });

  // Barres list fret numbers only; infer the covered string span.
  const barres = [];
  (position.barres || []).forEach((fret) => {
    let minString = 7;
    let maxString = 0;
    position.frets.forEach((f, i) => {
      if (f === fret) {
        const str = 6 - i;
        minString = Math.min(minString, str);
        maxString = Math.max(maxString, str);
      }
    });
    if (maxString > 0) barres.push({ fromString: maxString, toString: minString, fret });
  });

  // Resolve theme colors at draw time so the diagram follows light/dark.
  const styles = getComputedStyle(container);
  const fg = styles.getPropertyValue("--fg").trim() || "#e6e6e6";

  vexchords.draw(container, {
    chord,
    position: position.baseFret,
    barres,
    tuning: ["E", "A", "D", "G", "B", "E"],
  }, {
    width: 120,
    height: 140,
    defaultColor: fg,
    strokeColor: fg,
    bgColor: "transparent",
    labelColor: fg,
  });
};

const updateChordPopupContent = (chordName) => {
  const popup = chordPopup();
  const canInsert = canInsertChordAtActivePosition();
  const hasMultiple = currentChordPositions.length > 1;

  popup.innerHTML = `
    <div class="chord-popup-header">
      ${hasMultiple ? '<span class="chord-arrow" id="prev-chord">&lt;</span>' : ""}
      <h4>${escapeHtml(chordName)}</h4>
      ${hasMultiple ? '<span class="chord-arrow" id="next-chord">&gt;</span>' : ""}
    </div>
    ${hasMultiple ? `<div class="chord-position-indicator">${currentChordPositionIndex + 1}/${currentChordPositions.length}</div>` : ""}
    <div id="chord-diagram"></div>
    <jelly-button id="chord-insert-btn" size="small" variant="mint" class="chord-insert-btn"${canInsert ? "" : " disabled"}>Insert</jelly-button>
  `;

  const diagramContainer = popup.querySelector("#chord-diagram");
  if (currentChordPositions.length > 0) {
    renderChordDiagram(diagramContainer, currentChordPositions[currentChordPositionIndex]);
  } else {
    diagramContainer.innerHTML = '<div class="chord-not-found">Chord not found in DB</div>';
  }

  if (hasMultiple) {
    popup.querySelector("#prev-chord").addEventListener("click", (e) => {
      e.stopPropagation();
      currentChordPositionIndex =
        (currentChordPositionIndex - 1 + currentChordPositions.length) % currentChordPositions.length;
      updateChordPopupContent(chordName);
    });
    popup.querySelector("#next-chord").addEventListener("click", (e) => {
      e.stopPropagation();
      currentChordPositionIndex = (currentChordPositionIndex + 1) % currentChordPositions.length;
      updateChordPopupContent(chordName);
    });
  }

  const insertBtn = popup.querySelector("#chord-insert-btn");
  if (!canInsert) {
    insertBtn.title = currentChordPositions.length === 0
      ? "No chord shape available to insert"
      : "Add a tab block below this text line to insert";
  }
  insertBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!insertBtn.hasAttribute("disabled")) insertActiveChordFingering();
  });
};

export const showChordPopup = (element, chordName) => {
  const popup = chordPopup();
  if (!popup) return;

  // Clicking the same chord again toggles the popup off.
  if (activeChordElement === element && popup.classList.contains("visible")) {
    hideChordPopup();
    return;
  }

  activeChordElement = element;
  currentChordPositions = findChordData(chordName) || [];
  currentChordPositionIndex = 0;

  popup.classList.add("visible");
  updateChordPopupContent(chordName);

  const rect = element.getBoundingClientRect();
  const popupRect = popup.getBoundingClientRect();
  let top = rect.top - popupRect.height - 8;
  let left = rect.left + rect.width / 2 - popupRect.width / 2;
  if (left < 10) left = 10;
  if (left + popupRect.width > window.innerWidth - 10) {
    left = window.innerWidth - popupRect.width - 10;
  }
  if (top < 10) top = rect.bottom + 8;

  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
};

export const hideChordPopup = () => {
  chordPopup()?.classList.remove("visible");
  activeChordElement = null;
};

export const initChords = () => {
  // Close the popup when clicking anywhere else.
  document.addEventListener("click", (e) => {
    const popup = chordPopup();
    if (!popup || !popup.classList.contains("visible")) return;
    if (e.target.closest("#chord-popup") || e.target.classList.contains("chord")) return;
    hideChordPopup();
  });
};
