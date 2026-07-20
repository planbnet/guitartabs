// Application bootstrap: wire up modules, load the document, register the
// service worker.

import "./vendor/jelly.js";
import { state, replaceDocument, saveUndoState } from "./core/store.js";
import { decodeShare } from "./core/share.js";
import { load, initPersistence } from "./core/persistence.js";
import { focusKeyboard } from "./ui/dom.js";
import { initTheme } from "./ui/theme.js";
import { initTooltip } from "./ui/tooltip.js";
import { initChords } from "./ui/chords.js";
import { initSelection } from "./ui/selection.js";
import { initEditorView } from "./ui/editor-view.js";
import { initKeyboard } from "./ui/keyboard.js";
import { initToolbar } from "./ui/toolbar.js";
import { initModals } from "./ui/modals.js";
import { toast } from "./ui/toast.js";
import * as dbx from "./dropbox/api.js";
import { initDropboxUI, showFolderBrowser } from "./dropbox/ui.js";

// Load a shared document from a ?tab= URL parameter, then clean the URL.
const loadFromUrl = () => {
  const params = new URLSearchParams(window.location.search);
  const compressed = params.get("tab");
  if (!compressed) return false;

  const shared = decodeShare(compressed);
  if (!shared) {
    console.error("Failed to load shared tab from URL");
    return false;
  }

  replaceDocument(shared);

  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete("tab");
  window.history.replaceState({}, "", cleanUrl.toString());
  return true;
};

const registerServiceWorker = () => {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      // Clean up the old registration that was scoped to /js/.
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const reg of registrations) {
        if (new URL(reg.scope).pathname.endsWith("/js/")) {
          await reg.unregister();
        }
      }
      await navigator.serviceWorker.register("./sw.js");
    } catch (err) {
      console.warn("Service Worker registration failed:", err);
    }
  });
};

const init = async () => {
  initPersistence();
  initTheme();
  initTooltip();
  initChords();
  initSelection();
  initEditorView();
  initKeyboard();
  initToolbar();
  initModals();
  initDropboxUI();

  // Dropbox OAuth redirect must be handled before the URL is inspected
  // for shared tabs.
  try {
    const wasRedirect = await dbx.handleRedirect();
    if (wasRedirect && dbx.getFolderPath() == null) {
      setTimeout(() => showFolderBrowser(""), 500);
    }
  } catch (err) {
    console.error("Dropbox auth error:", err);
    toast("Failed to connect to Dropbox. Please try again.", "danger");
  }

  if (!loadFromUrl()) {
    replaceDocument(load() || { blocks: [] });
  }

  focusKeyboard();
  registerServiceWorker();

  // Baseline snapshot so the first edit can be undone.
  setTimeout(() => saveUndoState(), 100);
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
