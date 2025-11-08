// === Main Application Initialization ===

(() => {
  // Button event listeners
  const setupButtonListeners = () => {
    document.getElementById("btn-new-line").addEventListener("click", newLineBlock);
    document.getElementById("btn-new-text").addEventListener("click", newTextBlock);
    document.getElementById("btn-mode-toggle").addEventListener("click", toggleEditMode);
    document.getElementById("btn-undo").addEventListener("click", undo);
    document.getElementById("inp-len").addEventListener("input", (e) => {
      const L = parseInt(e.target.value, 10);
      if (!isNaN(L) && L >= 50 && L <= 120) {
        applyLength(L);
      }
    });
    document.getElementById("btn-clear").addEventListener("click", clearAll);
  };

  // Global event listeners
  const setupGlobalListeners = () => {
    document.addEventListener("keydown", onKeyDown);
    
    // Hide tooltip on any click
    document.addEventListener("click", () => {
      if (typeof hideNoteTooltip === "function") {
        hideNoteTooltip();
      }
    });
  };

  // Application initialization
  const init = () => {
    // Load saved data or create initial content
    if (!load()) {
      blocks.push(makeEmptyBlock(lineLength));
    } else {
      // reflect stored length in UI
      document.getElementById("inp-len").value = String(lineLength);
    }
    
    // Initialize mode button state
    const modeBtn = document.getElementById("btn-mode-toggle");
    if (editMode === 'shift') {
      modeBtn.textContent = "Mode: Shift";
      modeBtn.classList.add('insert-mode');
    } else if (editMode === 'insert') {
      modeBtn.textContent = "Mode: Insert";
      modeBtn.classList.add('insert-mode');
    } else {
      modeBtn.textContent = "Mode: Replace";
      modeBtn.classList.remove('insert-mode');
    }
    
    ensureAtLeastOneBlock();
    render();
    focusKeyboard();
    
    // Save initial state for undo
    setTimeout(() => saveUndoState(), 100);
  };

  // Start the application
  const start = () => {
    setupButtonListeners();
    setupGlobalListeners();
    setupUIInteractions();
    init();
  };

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
