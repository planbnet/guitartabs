// Note-name tooltip shown when clicking a fret number in the grid.

import { on } from "../core/bus.js";
import { calculateNote } from "../core/model.js";
import { $ } from "./dom.js";

const tooltip = () => $("note-tooltip");

export const showNoteTooltip = (cell, stringIdx, fret) => {
  const el = tooltip();
  if (!el) return;
  const note = calculateNote(stringIdx, fret);
  if (!note) return;

  el.textContent = note;
  el.classList.add("visible");

  const rect = cell.getBoundingClientRect();
  el.style.left = `${rect.left + rect.width / 2 - el.offsetWidth / 2}px`;
  el.style.top = `${rect.top - el.offsetHeight - 8}px`;
};

export const hideNoteTooltip = () => {
  tooltip()?.classList.remove("visible");
};

export const initTooltip = () => {
  on("cursor-changed", hideNoteTooltip);
  document.addEventListener("click", hideNoteTooltip);
};
