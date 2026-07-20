// localStorage persistence. Key and payload shape are stable — existing
// saved documents must keep loading, including the legacy raw-array format.

import { STORAGE_KEY, DEFAULT_LEN } from "./constants.js";
import { on } from "./bus.js";
import { state } from "./store.js";

export const save = () => {
  const { blocks, lineLength, cur, editMode } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ blocks, lineLength, cur, editMode }));
};

// Returns a {blocks, lineLength, cur, editMode} payload or null.
export const load = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.blocks)) return null;

    // Legacy format: blocks were raw char[6][len] arrays.
    const blocks =
      payload.blocks.length > 0 && Array.isArray(payload.blocks[0])
        ? payload.blocks.map((data) => ({ type: "tab", data }))
        : payload.blocks;

    return {
      blocks,
      lineLength: payload.lineLength || DEFAULT_LEN,
      cur: payload.cur || undefined,
      editMode: payload.editMode || "replace",
    };
  } catch {
    return null;
  }
};

// Autosave on every dirty signal.
export const initPersistence = () => {
  on("dirty", save);
};
