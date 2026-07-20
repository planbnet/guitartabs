// Toolbar wiring. The jelly-segmented mode control is the single source of
// truth for displaying the edit mode; state changes flow through the store.

import { on } from "../core/bus.js";
import { state, setEditMode, cycleEditMode, undo } from "../core/store.js";
import { newTabBlock, newTextBlock, clearAllBlocks } from "../core/editing.js";
import { $, focusKeyboard } from "./dom.js";
import { confirmDialog } from "./dialogs.js";
import { enterPerformMode } from "./perform.js";
import { clearCurrentFile } from "../dropbox/ui.js";

const updateModeControl = () => {
  const el = $("mode-control");
  if (el && el.value !== state.editMode) {
    el.value = state.editMode;
  }
};

const clearAll = async () => {
  const confirmed = await confirmDialog({
    message: "Clear all lines?",
    confirmLabel: "Clear",
  });
  if (!confirmed) return;
  clearAllBlocks();
  clearCurrentFile();
  focusKeyboard();
};

export const initToolbar = () => {
  $("btn-new-line").addEventListener("click", newTabBlock);
  $("btn-new-text").addEventListener("click", newTextBlock);
  $("btn-undo").addEventListener("click", undo);
  $("btn-clear").addEventListener("click", clearAll);
  $("btn-perform").addEventListener("click", enterPerformMode);

  const modeControl = $("mode-control");
  modeControl.addEventListener("change", () => {
    setEditMode(modeControl.value);
    focusKeyboard();
  });

  on("editmode-changed", updateModeControl);
  on("request-editmode-cycle", cycleEditMode);
  updateModeControl();
};
