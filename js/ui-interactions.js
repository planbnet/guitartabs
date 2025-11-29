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

// Setup all UI interactions
const setupUIInteractions = () => {
  setupLegendModal();
  setupSettingsModal();
  setupTextModal();

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
