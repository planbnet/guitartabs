// === UI Interactions and Modals ===

// Hide any popovers/tooltips
const hidePopover = () => {
  if (typeof hideNoteTooltip === "function") {
    hideNoteTooltip();
  }
};

// Legend modal interactions
const setupLegendModal = () => {
  const modal = document.getElementById("legend");

  // Show legend modal
  document.getElementById("btn-legend").addEventListener("click", () => {
    modal.style.display = "flex";
  });

  document.getElementById("legend-close").addEventListener("click", () => {
    modal.style.display = "none";
    focusKeyboard();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      focusKeyboard();
    }
  });

  // Legend symbol buttons
  document.querySelectorAll(".legend-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (isTabBlock(blocks[cur.block])) {
        const symbol = e.target.dataset.symbol;
        saveUndoState();

        // Special handling for | - insert across all strings
        if (symbol === '|') {
          for (let s = 0; s < 6; s++) {
            blocks[cur.block].data[s][cur.col] = "|";
          }
        } else {
          blocks[cur.block].data[cur.stringIdx][cur.col] = symbol;
        }

        // Move cursor forward
        if (cur.col < lineLength - 1) {
          setCursor(cur.block, cur.stringIdx, cur.col + 1);
        } else {
          setCursor(cur.block, cur.stringIdx, cur.col);
        }
        render();
        save();
        // Close modal and focus keyboard
        modal.style.display = "none";
        focusKeyboard();
      }
    });
  });
};

const setupSettingsModal = () => {
  const modal = document.getElementById("settings-modal");
  if (!modal) return;
  const display = document.getElementById("settings-len-display");
  const syncDisplay = () => {
    const rounded = Math.round(lineLength / 10) * 10;
    display.textContent = `${rounded}`;
  };
  const setLengthFromDisplay = (delta) => {
    let value = parseInt(display.textContent, 10) || lineLength;
    value = Math.round(value / 10) * 10;
    value = clamp(value + delta, 50, 120);
    value = Math.round(value / 10) * 10;
    display.textContent = `${value}`;
    applyLength(value);
  };
  document.getElementById("btn-settings").addEventListener("click", () => {
    syncDisplay();
    modal.style.display = "flex";
  });
  document.getElementById("settings-len-dec").addEventListener("click", () => {
    setLengthFromDisplay(-10);
  });
  document.getElementById("settings-len-inc").addEventListener("click", () => {
    setLengthFromDisplay(+10);
  });
  document.getElementById("settings-close").addEventListener("click", () => {
    modal.style.display = "none";
    focusKeyboard();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
      focusKeyboard();
    }
  });
};

const setupTextModal = () => {
  const modal = document.getElementById("text-modal");
  if (!modal) return;
  const textarea = document.getElementById("text-modal-content");
  const fileInput = document.getElementById("file-input");

  const closeModal = () => {
    modal.style.display = "none";
    focusKeyboard();
  };

  const openModal = () => {
    if (typeof formatContentForExport === "function") {
      textarea.value = formatContentForExport();
    }
    modal.style.display = "flex";
    // Use setTimeout to ensure the modal is fully displayed before focusing
    setTimeout(() => textarea.focus(), 10);
  };

  document.getElementById("btn-text-modal").addEventListener("click", openModal);
  document.getElementById("text-cancel").addEventListener("click", closeModal);

  document.getElementById("text-update").addEventListener("click", () => {
    if (typeof parseImportedContent === "function") {
      parseImportedContent(textarea.value);
      render();
      save();
    }
    closeModal();
  });

  document.getElementById("text-export").addEventListener("click", () => {
    if (typeof exportToFile === "function") {
      exportToFile(textarea.value);
    }
  });

  document.getElementById("text-import").addEventListener("click", () => {
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

  document.getElementById("text-import-clipboard").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        textarea.value = text;
      }
    } catch (err) {
      alert('Unable to read clipboard. Please allow clipboard access or paste manually.');
    }
  });

  document.getElementById("text-share").addEventListener("click", async () => {
    if (typeof shareTab === "function") {
      await shareTab();
    }
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
};

// Dropbox UI sync - updates settings panel and toolbar button visibility
const dbxSyncSettingsUI = () => {
  const connected = typeof dbxIsConnected === 'function' && dbxIsConnected();

  // Settings panel sections
  const connectedSection = document.getElementById('dbx-connected-section');
  const disconnectedSection = document.getElementById('dbx-disconnected-section');
  if (connectedSection) connectedSection.style.display = connected ? 'block' : 'none';
  if (disconnectedSection) disconnectedSection.style.display = connected ? 'none' : 'block';

  // Toolbar buttons
  const openBtn = document.getElementById('btn-dbx-open');
  const saveBtn = document.getElementById('btn-dbx-save');
  if (openBtn) openBtn.style.display = connected ? '' : 'none';
  if (saveBtn) saveBtn.style.display = connected ? '' : 'none';

  // Folder display
  const folderDisplay = document.getElementById('dbx-folder-display');
  const folder = localStorage.getItem('dbx_folder_path');
  if (folderDisplay) folderDisplay.textContent = folder || '/ (root)';

  // Current file display
  const currentFile = localStorage.getItem('dbx_current_file');
  const fileRow = document.getElementById('dbx-current-file-row');
  const fileDisplay = document.getElementById('dbx-current-file-display');
  if (fileRow && fileDisplay) {
    if (currentFile) {
      fileDisplay.textContent = currentFile.split('/').pop();
      fileRow.style.display = '';
    } else {
      fileRow.style.display = 'none';
    }
  }
};

const setupDropboxUI = () => {
  // --- Settings modal Dropbox controls ---
  const connectBtn = document.getElementById('dbx-connect');
  if (connectBtn) {
    connectBtn.addEventListener('click', () => {
      if (typeof dbxStartAuth === 'function') dbxStartAuth();
    });
  }

  const disconnectBtn = document.getElementById('dbx-disconnect');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', () => {
      if (typeof dbxDisconnect === 'function') dbxDisconnect();
      localStorage.removeItem('dbx_folder_path');
      localStorage.removeItem('dbx_current_file');
      dbxSyncSettingsUI();
    });
  }

  const changeFolderBtn = document.getElementById('dbx-change-folder');
  if (changeFolderBtn) {
    changeFolderBtn.addEventListener('click', () => {
      const current = localStorage.getItem('dbx_folder_path') || '';
      if (typeof dbxShowFolderBrowser === 'function') dbxShowFolderBrowser(current);
    });
  }

  // Sync settings UI when settings modal opens
  const origSettingsClick = document.getElementById('btn-settings');
  if (origSettingsClick) {
    origSettingsClick.addEventListener('click', dbxSyncSettingsUI);
  }

  // --- Toolbar button listeners ---
  const openBtn = document.getElementById('btn-dbx-open');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (typeof dbxShowOpenModal === 'function') dbxShowOpenModal();
    });
  }

  const saveBtn = document.getElementById('btn-dbx-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      if (typeof dbxSaveFile === 'function') dbxSaveFile();
    });
  }

  // --- Open modal ---
  const openModal = document.getElementById('dbx-open-modal');
  const closeOpenModal = () => {
    if (openModal) openModal.style.display = 'none';
    focusKeyboard();
  };

  const openCloseBtn = document.getElementById('dbx-open-close');
  if (openCloseBtn) openCloseBtn.addEventListener('click', closeOpenModal);

  const openFolderBtn = document.getElementById('dbx-open-folder');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      const current = localStorage.getItem('dbx_folder_path') || '';
      if (typeof dbxShowFolderBrowser === 'function') dbxShowFolderBrowser(current);
    });
  }

  if (openModal) {
    openModal.addEventListener('click', (e) => {
      if (e.target === openModal) closeOpenModal();
    });
  }

  // --- Folder browser modal ---
  const folderModal = document.getElementById('dbx-folder-modal');
  const closeFolderModal = () => {
    if (folderModal) folderModal.style.display = 'none';
    focusKeyboard();
  };

  const folderCloseBtn = document.getElementById('dbx-folder-close');
  if (folderCloseBtn) folderCloseBtn.addEventListener('click', closeFolderModal);

  const folderSelectBtn = document.getElementById('dbx-folder-select');
  if (folderSelectBtn) {
    folderSelectBtn.addEventListener('click', () => {
      const browsePath = folderModal._browsePath || '';
      localStorage.setItem('dbx_folder_path', browsePath);
      closeFolderModal();
      dbxSyncSettingsUI();

      // If the open modal is visible, refresh it with the new folder
      if (openModal && openModal.style.display === 'flex') {
        if (typeof dbxRenderOpenList === 'function') dbxRenderOpenList(browsePath);
      }
    });
  }

  if (folderModal) {
    folderModal.addEventListener('click', (e) => {
      if (e.target === folderModal) closeFolderModal();
    });
  }

  // --- Save modal ---
  const saveModal = document.getElementById('dbx-save-modal');
  const closeSaveModal = () => {
    if (saveModal) saveModal.style.display = 'none';
    focusKeyboard();
  };

  const saveCancelBtn = document.getElementById('dbx-save-cancel');
  if (saveCancelBtn) saveCancelBtn.addEventListener('click', closeSaveModal);

  const saveConfirmBtn = document.getElementById('dbx-save-confirm');
  if (saveConfirmBtn) {
    saveConfirmBtn.addEventListener('click', async () => {
      const input = document.getElementById('dbx-save-filename');
      const errorEl = document.getElementById('dbx-save-error');
      let filename = (input.value || '').trim();

      if (!filename) {
        errorEl.textContent = 'Please enter a filename.';
        errorEl.style.display = 'block';
        return;
      }

      // Ensure .txt extension
      if (!filename.toLowerCase().endsWith('.txt')) {
        filename += '.txt';
      }

      filename = sanitizeFilename(filename.replace(/\.txt$/i, '')) + '.txt';
      const folder = localStorage.getItem('dbx_folder_path') || '';
      const path = folder + '/' + filename;

      errorEl.style.display = 'none';
      saveConfirmBtn.disabled = true;
      saveConfirmBtn.textContent = 'Saving...';

      try {
        const content = formatContentForExport();
        await dbxUploadFile(path, content);
        localStorage.setItem('dbx_current_file', path);
        closeSaveModal();
        dbxSyncSettingsUI();
        if (typeof dbxShowToast === 'function') dbxShowToast('Saved ' + filename);
      } catch (err) {
        errorEl.textContent = 'Save failed: ' + err.message;
        errorEl.style.display = 'block';
      } finally {
        saveConfirmBtn.disabled = false;
        saveConfirmBtn.textContent = 'Save';
      }
    });
  }

  // Handle Enter key in filename input
  const saveFilenameInput = document.getElementById('dbx-save-filename');
  if (saveFilenameInput) {
    saveFilenameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (saveConfirmBtn) saveConfirmBtn.click();
      }
    });
  }

  if (saveModal) {
    saveModal.addEventListener('click', (e) => {
      if (e.target === saveModal) closeSaveModal();
    });
  }

  // --- Initial sync ---
  dbxSyncSettingsUI();
};

// Setup all UI interactions
const setupUIInteractions = () => {
  setupLegendModal();
  setupSettingsModal();
  setupTextModal();
  setupDropboxUI();

  // Keep keyboard focused on iPad when tapping the editor area
  // But don't steal focus if a modal is open
  const shouldFocusKeyboard = () => {
    const modals = document.querySelectorAll('.modal');
    const isModalOpen = Array.from(modals).some(modal =>
      modal.style.display === 'flex' || modal.style.display === 'block'
    );
    return !isModalOpen;
  };

  elEditor.addEventListener("mousedown", () => {
    if (shouldFocusKeyboard()) focusKeyboard();
  });
  elEditor.addEventListener("touchstart", () => {
    if (shouldFocusKeyboard()) focusKeyboard();
  }, { passive: true });
};
