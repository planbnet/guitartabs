// Settings, Tab-Text and Legend dialogs, plus export/share actions.

import { MIN_LEN, MAX_LEN, STRING_COUNT } from "../core/constants.js";
import { clamp, isTabBlock } from "../core/model.js";
import { state, setCursor, saveUndoState, replaceDocument } from "../core/store.js";
import { applyLength } from "../core/editing.js";
import { formatContentForExport, parseImportedContent, extractTitle, sanitizeFilename } from "../core/serialize.js";
import { encodeShare } from "../core/share.js";
import { emit } from "../core/bus.js";
import { jellyIcon } from "../vendor/jelly.js";
import { $, focusKeyboard, isAnyDialogOpen } from "./dom.js";
import { openDialog, closeDialog } from "./dialogs.js";
import { exportToPdf } from "./pdf.js";
import { toast } from "./toast.js";
import { syncSettingsUI, clearCurrentFile } from "../dropbox/ui.js";

// --- Export / share ---

// Download the content as a .txt named after the tab's title.
const exportToFile = (content) => {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const title = extractTitle(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = title ? `${sanitizeFilename(title)}.txt` : "guitar-tab.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const shareTab = async () => {
  try {
    const compressed = encodeShare({ blocks: state.blocks, lineLength: state.lineLength });
    const url = new URL(window.location.href);
    url.searchParams.set("tab", compressed);
    const shareUrl = url.toString();

    if (shareUrl.length > 2000) {
      toast(`Tab is too large to share via URL (${shareUrl.length} characters, limit ~2000). Try splitting into smaller tabs or use Export.`, "warning");
      return;
    }

    await navigator.clipboard.writeText(shareUrl);
    toast("Share URL copied to clipboard!", "success");
  } catch (err) {
    console.error("Share failed:", err);
    toast("Failed to create share URL. Please try exporting instead.", "danger");
  }
};

// --- Settings dialog ---

const setupSettingsDialog = () => {
  const dialog = $("settings-modal");
  if (!dialog) return;

  const slider = $("settings-len-slider");
  const display = $("settings-len-display");

  const roundedLength = () => Math.round(state.lineLength / 10) * 10;

  const syncControls = () => {
    if (display) display.textContent = `${roundedLength()}`;
    if (slider && Number(slider.value) !== roundedLength()) slider.value = roundedLength();
  };

  const setLength = (value) => {
    const L = Math.round(clamp(value, MIN_LEN, MAX_LEN) / 10) * 10;
    applyLength(L);
    syncControls();
  };

  slider?.addEventListener("change", () => setLength(parseInt(slider.value, 10)));

  $("btn-settings").addEventListener("click", () => {
    syncControls();
    syncSettingsUI();
    openDialog(dialog);
  });
  $("settings-close")?.addEventListener("click", () => closeDialog(dialog));
};

// --- Tab-Text dialog ---

const setupTextDialog = () => {
  const dialog = $("text-modal");
  if (!dialog) return;
  const textarea = $("text-modal-content");
  const fileInput = $("file-input");

  const open = () => {
    textarea.value = formatContentForExport(state.blocks);
    openDialog(dialog);
    setTimeout(() => textarea.focus(), 10);
  };

  $("btn-text-modal").addEventListener("click", open);
  $("text-cancel").addEventListener("click", () => closeDialog(dialog));

  $("text-update").addEventListener("click", () => {
    replaceDocument(parseImportedContent(textarea.value, state.lineLength));
    clearCurrentFile();
    closeDialog(dialog);
  });

  $("text-export").addEventListener("click", () => exportToFile(textarea.value));

  $("text-pdf").addEventListener("click", () => {
    const parsed = parseImportedContent(textarea.value, state.lineLength);
    exportToPdf(parsed.blocks, { lineLength: parsed.lineLength, title: extractTitle(textarea.value) });
  });

  $("text-import").addEventListener("click", () => {
    if (!fileInput) return;
    fileInput.value = "";
    fileInput.onchange = (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        textarea.value = e.target.result || "";
        fileInput.value = "";
        fileInput.onchange = null;
      };
      reader.readAsText(file);
    };
    fileInput.click();
  });

  $("text-import-clipboard").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) textarea.value = text;
    } catch {
      toast("Unable to read clipboard. Please allow clipboard access or paste manually.", "warning");
    }
  });

  $("text-share").addEventListener("click", shareTab);
};

// --- Legend dialog ---

const setupLegendDialog = () => {
  const dialog = $("legend");
  if (!dialog) return;

  $("btn-legend").addEventListener("click", () => openDialog(dialog));
  $("legend-close").addEventListener("click", () => closeDialog(dialog));

  document.querySelectorAll(".legend-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!isTabBlock(state.blocks[state.cur.block])) return;
      const symbol = btn.dataset.symbol;
      saveUndoState();

      if (symbol === "|") {
        for (let s = 0; s < STRING_COUNT; s++) {
          state.blocks[state.cur.block].data[s][state.cur.col] = "|";
        }
      } else {
        state.blocks[state.cur.block].data[state.cur.stringIdx][state.cur.col] = symbol;
      }

      const insertedBlock = state.cur.block;
      if (state.cur.col < state.lineLength - 1) {
        setCursor(state.cur.block, state.cur.stringIdx, state.cur.col + 1);
      }
      emit("cells-changed", { block: insertedBlock });
      emit("dirty");

      closeDialog(dialog);
      focusKeyboard();
    });
  });
};

export const initModals = () => {
  const settingsBtn = $("btn-settings");
  if (settingsBtn && settingsBtn.tagName === "JELLY-ICON-BUTTON") {
    settingsBtn.innerHTML = jellyIcon("settings");
  }

  setupSettingsDialog();
  setupTextDialog();
  setupLegendDialog();

  // Tapping the editor summons the on-screen keyboard — unless a dialog has focus.
  const editor = $("editor");
  editor.addEventListener("mousedown", () => {
    if (!isAnyDialogOpen()) focusKeyboard();
  });
  editor.addEventListener("touchstart", () => {
    if (!isAnyDialogOpen()) focusKeyboard();
  }, { passive: true });
};
