// Dropbox UI: toolbar visibility, settings section, and the open/folder/save
// dialogs. One entry-list renderer serves both browse dialogs.

import * as dbx from "./api.js";
import { state, replaceDocument } from "../core/store.js";
import { parseImportedContent, formatContentForExport, extractTitle, sanitizeFilename } from "../core/serialize.js";
import { $ } from "./../ui/dom.js";
import { toast } from "../ui/toast.js";
import { openDialog, closeDialog, isDialogOpen } from "../ui/dialogs.js";

let folderBrowsePath = "";

// Keeps the settings panel and toolbar buttons in sync with connection state.
export const syncSettingsUI = () => {
  const connected = dbx.isConnected();

  const connectedSection = $("dbx-connected-section");
  const disconnectedSection = $("dbx-disconnected-section");
  if (connectedSection) connectedSection.classList.toggle("is-hidden", !connected);
  if (disconnectedSection) disconnectedSection.classList.toggle("is-hidden", connected);

  $("btn-dbx-open")?.classList.toggle("is-hidden", !connected);
  $("btn-dbx-save")?.classList.toggle("is-hidden", !connected);

  const folderDisplay = $("dbx-folder-display");
  if (folderDisplay) folderDisplay.textContent = dbx.getFolderPath() || "/ (root)";

  const currentFile = dbx.getCurrentFile();
  const fileRow = $("dbx-current-file-row");
  const fileDisplay = $("dbx-current-file-display");
  if (fileRow && fileDisplay) {
    if (currentFile) {
      fileDisplay.textContent = currentFile.split("/").pop();
      fileRow.classList.remove("is-hidden");
    } else {
      fileRow.classList.add("is-hidden");
    }
  }
};

export const clearCurrentFile = () => {
  dbx.clearCurrentFile();
  syncSettingsUI();
};

const openFile = async (path) => {
  try {
    const content = await dbx.downloadFile(path);
    replaceDocument(parseImportedContent(content, state.lineLength));
    dbx.setCurrentFile(path);
    syncSettingsUI();
  } catch (err) {
    toast(`Failed to open file: ${err.message}`, "danger");
  }
};

export const saveFile = async () => {
  const content = formatContentForExport(state.blocks);
  const currentFile = dbx.getCurrentFile();
  const hasContent = state.blocks.some((b) =>
    b.type === "text" ? (b.data || "").trim() !== "" : b.data.some((row) => row.some((ch) => ch !== "-" && ch !== "|" && ch !== " "))
  );

  if (currentFile && hasContent) {
    try {
      await dbx.uploadFile(currentFile, content);
      toast(`Saved ${currentFile.split("/").pop()}`, "success");
    } catch (err) {
      toast(`Failed to save: ${err.message}`, "danger");
    }
  } else {
    if (currentFile) clearCurrentFile();
    showSaveDialog(content);
  }
};

// --- Entry lists (shared by the Open and Folder dialogs) ---

// Path display: clickable breadcrumbs when the element is a
// <jelly-breadcrumbs>, plain text otherwise.
const renderPathEl = (el, path, onNavigate) => {
  if (el.tagName !== "JELLY-BREADCRUMBS") {
    el.textContent = path || "/";
    return;
  }
  el.innerHTML = "";
  const segments = (path || "").split("/").filter(Boolean);
  const addCrumb = (label, target, isCurrent) => {
    if (isCurrent) {
      const span = document.createElement("span");
      span.textContent = label;
      el.appendChild(span);
    } else {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = label;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        onNavigate(target);
      });
      el.appendChild(a);
    }
  };
  addCrumb("Dropbox", "", segments.length === 0);
  let acc = "";
  segments.forEach((segment, i) => {
    acc += `/${segment}`;
    addCrumb(segment, acc, i === segments.length - 1);
  });
};

// A remembered/selected folder can vanish from Dropbox between sessions
// (deleted or moved elsewhere). Recognize that specific failure so callers
// can fall back to root instead of leaving the user stuck on an error.
const isPathNotFoundError = (err) => /not_found/i.test(err.message || "");

// Renders folders (and optionally .txt files) into `listEl`.
const renderEntryList = async ({ path, listEl, pathEl, loadingEl, errorEl, showFiles, onNavigate, onPickFile }) => {
  listEl.innerHTML = "";
  errorEl.classList.add("is-hidden");
  loadingEl.classList.remove("is-hidden");
  renderPathEl(pathEl, path, onNavigate);

  const addItem = ({ icon, name, className, onClick }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `dbx-file-item ${className || ""}`.trim();
    const iconSpan = document.createElement("span");
    iconSpan.className = "dbx-icon";
    iconSpan.textContent = icon;
    const nameSpan = document.createElement("span");
    nameSpan.textContent = name;
    item.append(iconSpan, nameSpan);
    item.addEventListener("click", onClick);
    listEl.appendChild(item);
  };

  try {
    const entries = await dbx.listFolder(path);
    const folders = entries
      .filter((e) => e[".tag"] === "folder")
      .sort((a, b) => a.name.localeCompare(b.name));
    const files = showFiles
      ? entries
          .filter((e) => e[".tag"] === "file" && e.name.toLowerCase().endsWith(".txt"))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    loadingEl.classList.add("is-hidden");

    if (path && path !== "") {
      const parentPath = path.substring(0, path.lastIndexOf("/")) || "";
      addItem({
        icon: "..",
        name: "Parent folder",
        className: "folder dbx-parent-item",
        onClick: () => onNavigate(parentPath),
      });
    }

    folders.forEach((entry) => {
      addItem({
        icon: "\u{1F4C1}",
        name: entry.name,
        className: "folder",
        onClick: () => onNavigate(entry.path_display),
      });
    });

    files.forEach((entry) => {
      addItem({
        icon: "\u{1F3B5}",
        name: entry.name,
        onClick: () => onPickFile(entry.path_display),
      });
    });

    if (folders.length === 0 && files.length === 0) {
      const empty = document.createElement("div");
      empty.className = "dbx-loading";
      empty.textContent = showFiles ? "No folders or .txt files found" : "No subfolders";
      listEl.appendChild(empty);
    }
  } catch (err) {
    // The folder we were about to list no longer exists — fall back to the
    // root folder instead of leaving the user stuck on a dead-end error.
    if (path && isPathNotFoundError(err)) {
      if (path === dbx.getFolderPath()) {
        dbx.setFolderPath("");
        syncSettingsUI();
      }
      toast("That Dropbox folder no longer exists — showing the root folder instead.", "warning");
      onNavigate("");
      return;
    }

    loadingEl.classList.add("is-hidden");
    errorEl.textContent = err.message;
    errorEl.classList.remove("is-hidden");
  }
};

const renderOpenList = (path) => {
  return renderEntryList({
    path,
    listEl: $("dbx-open-list"),
    pathEl: $("dbx-open-path"),
    loadingEl: $("dbx-open-loading"),
    errorEl: $("dbx-open-error"),
    showFiles: true,
    onNavigate: renderOpenList,
    onPickFile: async (filePath) => {
      await openFile(filePath);
      closeDialog($("dbx-open-modal"));
    },
  });
};

const renderFolderList = (path) => {
  folderBrowsePath = path;
  return renderEntryList({
    path,
    listEl: $("dbx-folder-list"),
    pathEl: $("dbx-folder-path"),
    loadingEl: $("dbx-folder-loading"),
    errorEl: $("dbx-folder-error"),
    showFiles: false,
    onNavigate: renderFolderList,
  });
};

// --- Dialogs ---

export const showOpenDialog = () => {
  if (!dbx.isConnected()) {
    toast("Please connect to Dropbox first (Settings > Dropbox).", "warning");
    return;
  }
  const folderPath = dbx.getFolderPath();
  if (folderPath == null) {
    showFolderBrowser("");
    return;
  }
  openDialog($("dbx-open-modal"));
  renderOpenList(folderPath);
};

export const showFolderBrowser = (startPath) => {
  openDialog($("dbx-folder-modal"));
  renderFolderList(startPath || "");
};

const showSaveDialog = (content) => {
  const input = $("dbx-save-filename");
  $("dbx-save-error").classList.add("is-hidden");

  const title = extractTitle(content);
  const filename = title ? `${sanitizeFilename(title)}.txt` : "guitar-tab.txt";
  if ("value" in input) input.value = filename;

  openDialog($("dbx-save-modal"));
  setTimeout(() => {
    input.focus();
    input.select?.();
  }, 50);
};

const confirmSave = async () => {
  const input = $("dbx-save-filename");
  const errorEl = $("dbx-save-error");
  const confirmBtn = $("dbx-save-confirm");
  let filename = (input.value || "").trim();

  if (!filename) {
    errorEl.textContent = "Please enter a filename.";
    errorEl.classList.remove("is-hidden");
    return;
  }

  filename = `${sanitizeFilename(filename.replace(/\.txt$/i, ""))}.txt`;
  const folder = dbx.getFolderPath() || "";
  const path = `${folder}/${filename}`;

  errorEl.classList.add("is-hidden");
  confirmBtn.toggleAttribute("disabled", true);

  try {
    await dbx.uploadFile(path, formatContentForExport(state.blocks));
    dbx.setCurrentFile(path);
    closeDialog($("dbx-save-modal"));
    syncSettingsUI();
    toast(`Saved ${filename}`, "success");
  } catch (err) {
    errorEl.textContent = `Save failed: ${err.message}`;
    errorEl.classList.remove("is-hidden");
  } finally {
    confirmBtn.toggleAttribute("disabled", false);
  }
};

export const initDropboxUI = () => {
  // Settings panel controls
  $("dbx-connect")?.addEventListener("click", () => dbx.startAuth());
  $("dbx-disconnect")?.addEventListener("click", () => {
    dbx.disconnect();
    dbx.clearFolderPath();
    dbx.clearCurrentFile();
    syncSettingsUI();
  });
  $("dbx-change-folder")?.addEventListener("click", () => {
    showFolderBrowser(dbx.getFolderPath() || "");
  });

  // Toolbar buttons
  $("btn-dbx-open")?.addEventListener("click", showOpenDialog);
  $("btn-dbx-save")?.addEventListener("click", saveFile);

  // Open dialog
  $("dbx-open-close")?.addEventListener("click", () => closeDialog($("dbx-open-modal")));
  $("dbx-open-folder")?.addEventListener("click", () => {
    showFolderBrowser(dbx.getFolderPath() || "");
  });

  // Folder browser dialog
  $("dbx-folder-close")?.addEventListener("click", () => closeDialog($("dbx-folder-modal")));
  $("dbx-folder-select")?.addEventListener("click", () => {
    dbx.setFolderPath(folderBrowsePath || "");
    closeDialog($("dbx-folder-modal"));
    syncSettingsUI();
    if (isDialogOpen($("dbx-open-modal"))) {
      renderOpenList(folderBrowsePath || "");
    }
  });

  // Save dialog
  $("dbx-save-cancel")?.addEventListener("click", () => closeDialog($("dbx-save-modal")));
  $("dbx-save-confirm")?.addEventListener("click", confirmSave);
  $("dbx-save-filename")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmSave();
    }
  });

  syncSettingsUI();
};
