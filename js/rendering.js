// === DOM Rendering and UI Updates ===

// DOM elements
const elEditor = document.getElementById("editor");
const noteTooltip = document.getElementById("note-tooltip");

const DOCKED_TEXT_COLUMN_OFFSET = 2;

const tabColumnToTextColumn = (col) => {
  const safeCol = clamp(col, 0, lineLength - 1);
  return safeCol + DOCKED_TEXT_COLUMN_OFFSET;
};

const textColumnToTabColumn = (col) => {
  const safeCol = Math.max(col - DOCKED_TEXT_COLUMN_OFFSET, 0);
  return clamp(safeCol, 0, lineLength - 1);
};

const ensureDockedTextWidth = (blockIdx, textCol) => {
  const block = blocks[blockIdx];
  if (!block || !isTextBlock(block) || block.data.includes('\n')) return;
  const requiredLength = Math.max(textCol, block.data.length);
  if (block.data.length >= requiredLength) return;
  saveUndoState();
  block.data = block.data.padEnd(requiredLength, ' ');
  const textArea = document.querySelector(`textarea[data-block="${blockIdx}"]`);
  if (textArea) {
    const scrollTop = textArea.scrollTop;
    textArea.value = block.data;
    textArea.scrollTop = scrollTop;
  }
  save();
};

const focusDockedTextLine = (blockIdx, col) => {
  const textCol = tabColumnToTextColumn(col);
  ensureDockedTextWidth(blockIdx, textCol);
  const textArea = document.querySelector(`textarea[data-block="${blockIdx}"]`);
  const targetTextCol = Math.min(textCol, lineLength - 1 + DOCKED_TEXT_COLUMN_OFFSET);
  if (textArea) {
    textArea.focus();
    const pos = Math.min(targetTextCol, textArea.value.length);
    textArea.setSelectionRange(pos, pos);
  }
  cur.block = blockIdx;
  cur.stringIdx = 0;
  cur.col = clamp(col, 0, lineLength - 1);
  updateCursorOnly();
  if (typeof hideNoteTooltip === "function") {
    hideNoteTooltip();
  }
};

const focusTabFromDockedText = (textIdx, col, direction) => {
  const tabCol = textColumnToTabColumn(col);
  if (direction === 'down') {
    const tabIdx = getDockedTabForText(textIdx);
    if (tabIdx !== -1) {
      setCursor(tabIdx, 0, tabCol);
      focusKeyboard();
    }
  } else if (direction === 'up') {
    const prevTabIdx = findPreviousTabBlock(textIdx);
    if (prevTabIdx !== -1) {
      setCursor(prevTabIdx, 5, tabCol);
      focusKeyboard();
    }
  }
};

// Tooltip state
let tooltipTimeout = null;

// Parse multi-digit fret number from a cell and surrounding cells
const getFretNumberAtCell = (blockIdx, stringIdx, col) => {
  const block = blocks[blockIdx];
  if (!isTabBlock(block)) return null;
  
  const row = block.data[stringIdx];
  const char = row[col];
  
  // Check if current cell is a digit
  if (!/\d/.test(char)) return null;
  
  // Find the start of the number (look left for more digits)
  let startCol = col;
  while (startCol > 0 && /\d/.test(row[startCol - 1])) {
    startCol--;
  }
  
  // Find the end of the number (look right for more digits)
  let endCol = col;
  while (endCol < lineLength - 1 && /\d/.test(row[endCol + 1])) {
    endCol++;
  }
  
  const length = endCol - startCol + 1;
  
  // If more than 2 digits, treat each digit individually
  if (length > 2) {
    const fret = parseInt(char, 10);
    return isNaN(fret) ? null : fret;
  }
  
  // Extract the full number (1-2 digits)
  let numStr = '';
  for (let i = startCol; i <= endCol; i++) {
    numStr += row[i];
  }
  
  const fret = parseInt(numStr, 10);
  if (isNaN(fret)) return null;
  
  // If the number is > 36, treat each digit individually
  if (fret > 36) {
    const singleFret = parseInt(char, 10);
    return isNaN(singleFret) ? null : singleFret;
  }
  
  return fret;
};

// Show note tooltip
const showNoteTooltip = (cell, stringIdx, fret) => {
  if (!noteTooltip) return;
  
  const note = calculateNote(stringIdx, fret);
  if (!note) return;
  
  noteTooltip.textContent = note;
  noteTooltip.classList.add('visible');
  
  const rect = cell.getBoundingClientRect();
  noteTooltip.style.left = `${rect.left + rect.width / 2 - noteTooltip.offsetWidth / 2}px`;
  noteTooltip.style.top = `${rect.top - noteTooltip.offsetHeight - 8}px`;
};

// Hide note tooltip
const hideNoteTooltip = () => {
  if (!noteTooltip) return;
  noteTooltip.classList.remove('visible');
};

const selectionClassNames = ["sel", "sel-top", "sel-bottom", "sel-left", "sel-right", "sel-corner-tl", "sel-corner-tr", "sel-corner-bl", "sel-corner-br"];
const selectionClassSelector = selectionClassNames.map(cls => `.ch.${cls}`).join(", ");

const highlightCell = (blockIdx, stringIdx, col, add, meta = {}) => {
  if (!elEditor) return;
  const blockEl = elEditor.children[blockIdx];
  if (!blockEl) return;
  const lineEl = blockEl.querySelectorAll(".line")[stringIdx];
  if (!lineEl) return;
  const charsContainer = lineEl.querySelector(".chars");
  if (!charsContainer) return;
  const cell = charsContainer.children[col];
  if (!cell) return;
  selectionClassNames.forEach(cls => cell.classList.remove(cls));
  if (!add) return;
  cell.classList.add("sel");
  if (meta.top) cell.classList.add("sel-top");
  if (meta.bottom) cell.classList.add("sel-bottom");
  if (meta.left) cell.classList.add("sel-left");
  if (meta.right) cell.classList.add("sel-right");
  if (meta.top && meta.left) cell.classList.add("sel-corner-tl");
  if (meta.top && meta.right) cell.classList.add("sel-corner-tr");
  if (meta.bottom && meta.left) cell.classList.add("sel-corner-bl");
  if (meta.bottom && meta.right) cell.classList.add("sel-corner-br");
};

function refreshClipboardButtons() {
  document.querySelectorAll(".clipboard-btn").forEach(btn => {
    const block = parseInt(btn.dataset.block, 10);
    if (Number.isNaN(block)) {
      btn.style.display = "none";
      return;
    }
    const blockData = blocks[block];
    if (!blockData || !isTabBlock(blockData)) {
      btn.style.display = "none";
      return;
    }
    let visible = false;
    switch (btn.dataset.role) {
      case "copy":
        visible = !!selection && selection.block === block;
        break;
      case "paste":
        visible = cur.block === block && hasClipboardData();
        break;
      case "clear":
        visible = cur.block === block;
        break;
      case "delete":
        visible = cur.block === block;
        break;
    }
    btn.style.display = visible ? "inline-flex" : "none";
  });
}

function updateSelectionHighlight() {
  if (selectionClassSelector) {
    document.querySelectorAll(selectionClassSelector).forEach(el => {
      selectionClassNames.forEach(cls => el.classList.remove(cls));
    });
  }
  if (!selection || selection.block == null) {
    refreshClipboardButtons();
    return;
  }
  for (let stringIdx = selection.startString; stringIdx <= selection.endString; stringIdx++) {
    for (let col = selection.startCol; col <= selection.endCol; col++) {
      const meta = {
        top: stringIdx === selection.startString,
        bottom: stringIdx === selection.endString,
        left: col === selection.startCol,
        right: col === selection.endCol
      };
      highlightCell(selection.block, stringIdx, col, true, meta);
    }
  }
  refreshClipboardButtons();
}

const cancelSelectionTimer = () => {
  if (selectionDrag.timer) {
    clearTimeout(selectionDrag.timer);
    selectionDrag.timer = null;
  }
  if (!selectionDrag.active) {
    selectionDrag.touchId = null;
  }
};

const activateSelectionFromAnchor = () => {
  if (!selectionDrag.anchor || selectionDrag.block == null) return;
  selectionDrag.pending = false;
  selectionDrag.active = true;
  const { stringIdx, col } = selectionDrag.anchor;
  setSelection({ block: selectionDrag.block, startString: stringIdx, endString: stringIdx, startCol: col, endCol: col });
};

const startSelectionGesture = (blockIdx, stringIdx, col, pointerType, opts = {}) => {
  const immediate = opts.immediate !== false;
  selectionDrag.pointerType = pointerType;
  selectionDrag.block = blockIdx;
  selectionDrag.anchor = { stringIdx, col };
  selectionDrag.pending = !immediate;
  selectionDrag.active = immediate;
  if (immediate) {
    setSelection({ block: blockIdx, startString: stringIdx, endString: stringIdx, startCol: col, endCol: col });
  }
};

const updateSelectionFromCell = (blockIdx, stringIdx, col) => {
  if (!selectionDrag.active || selectionDrag.block !== blockIdx || !selectionDrag.anchor) return;
  setSelection({
    block: blockIdx,
    startString: selectionDrag.anchor.stringIdx,
    endString: stringIdx,
    startCol: selectionDrag.anchor.col,
    endCol: col
  }, { stringIdx, col }); // Pass current mouse position as cursor location
};

const handleSelectionPointerMove = (clientX, clientY, pointerType) => {
  if ((!selectionDrag.active && !selectionDrag.pending) || selectionDrag.pointerType !== pointerType) return;
  const target = document.elementFromPoint(clientX, clientY);
  if (!target) return;
  const cell = target.closest(".ch");
  if (!cell) return;
  const blockIdx = parseInt(cell.dataset.block, 10);
  const stringIdx = parseInt(cell.dataset.string, 10);
  const col = parseInt(cell.dataset.col, 10);
  if ([blockIdx, stringIdx, col].some(Number.isNaN)) return;
  if (blockIdx !== selectionDrag.block) return;
  if (selectionDrag.pending) {
    activateSelectionFromAnchor();
  }
  updateSelectionFromCell(blockIdx, stringIdx, col);
};

const endSelectionGesture = (pointerType, force = false) => {
  if (!selectionDrag.active && !selectionDrag.timer) {
    selectionDrag.pending = false;
    selectionDrag.pointerType = null;
    selectionDrag.block = null;
    selectionDrag.anchor = null;
    selectionDrag.touchId = null;
    return;
  }
  if (!force && selectionDrag.pointerType && pointerType && selectionDrag.pointerType !== pointerType) {
    return;
  }
  cancelSelectionTimer();
  selectionDrag.active = false;
  selectionDrag.pending = false;
  selectionDrag.pointerType = null;
  selectionDrag.block = null;
  selectionDrag.anchor = null;
  selectionDrag.touchId = null;
};

const handleTouchMoveSelection = (e) => {
  if (selectionDrag.timer && !selectionDrag.active) {
    cancelSelectionTimer();
    return;
  }
  if (!selectionDrag.active || selectionDrag.pointerType !== "touch") return;
  const touch = Array.from(e.touches).find(t => selectionDrag.touchId == null || t.identifier === selectionDrag.touchId);
  if (!touch) return;
  selectionDrag.touchId = touch.identifier;
  e.preventDefault();
  handleSelectionPointerMove(touch.clientX, touch.clientY, "touch");
};

document.addEventListener("mousemove", (e) => handleSelectionPointerMove(e.clientX, e.clientY, "mouse"));
document.addEventListener("mouseup", () => endSelectionGesture("mouse"));
document.addEventListener("touchmove", handleTouchMoveSelection, { passive: false });
document.addEventListener("touchend", () => endSelectionGesture("touch"));
document.addEventListener("touchcancel", () => endSelectionGesture("touch"));
document.addEventListener("mousedown", (e) => {
  if (!selection) return;
  if (
    e.target.closest(".ch") ||
    e.target.closest(".clipboard-btn") ||
    e.target.closest(".block-btn") ||
    e.target.closest(".block-remove-handle")
  ) {
    return;
  }
  clearSelection();
  refreshClipboardButtons();
});

// Lightweight cursor update without full re-render
const handleCellMouseDown = (blockIdx, stringIdx, col, event) => {
  if (event.button !== 0) return;
  endSelectionGesture("mouse", true);
  cancelSelectionTimer();
  startSelectionGesture(blockIdx, stringIdx, col, "mouse", { immediate: false });
  clearSelection();
  refreshClipboardButtons();
};

const handleCellTouchStart = (blockIdx, stringIdx, col, event) => {
  if (event.touches.length > 1) return;
  endSelectionGesture("touch", true);
  cancelSelectionTimer();
  const touch = event.changedTouches[0];
  selectionDrag.timer = setTimeout(() => {
    cancelSelectionTimer();
    selectionDrag.touchId = touch.identifier;
    startSelectionGesture(blockIdx, stringIdx, col, "touch");
  }, 300);
};

const updateCursorOnly = () => {
  if (!elEditor) return;
  
  document.querySelectorAll(".cursor").forEach(el => el.classList.remove("cursor"));
  
  const blockEl = elEditor.children[cur.block];
  if (!blockEl) return;
  
  const currentBlock = blocks[cur.block];
  if (isTabBlock(currentBlock)) {
    // Get all .line elements and select the correct one by index
    const stringElements = blockEl.querySelectorAll('.line');
    const stringEl = stringElements[cur.stringIdx];
    if (stringEl) {
      const charsContainer = stringEl.querySelector('.chars');
      if (charsContainer) {
        const cellEl = charsContainer.children[cur.col];
        if (cellEl) cellEl.classList.add("cursor");
      }
    }
  }
};

// Full DOM render
const render = () => {
  if (!elEditor) return;
  elEditor.innerHTML = "";
  
  blocks.forEach((block, bi) => {
    const blockEl = document.createElement("div");
    blockEl.className = "block";
    
    if (isTabBlock(block)) {
      // Render tab block
      blockEl.className += " tab-block";
      
      // Check if previous block is a docked text block
      const prevBlock = blocks[bi - 1];
      if (prevBlock && isTextBlock(prevBlock) && !prevBlock.data.includes('\n')) {
        blockEl.className += " has-docked-text";
      }

      const controls = document.createElement("div");
      controls.className = "block-controls";

      const moveUpBtn = document.createElement("button");
      moveUpBtn.textContent = "↑";
      moveUpBtn.className = "block-btn block-btn-equal";
      moveUpBtn.title = "Move up";
      moveUpBtn.disabled = (bi === 0);
      moveUpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveBlock(bi, -1);
      });
      controls.appendChild(moveUpBtn);

      const deleteSelectionBtn = document.createElement("button");
      deleteSelectionBtn.className = "block-btn block-btn-equal clipboard-btn";
      deleteSelectionBtn.dataset.role = "delete";
      deleteSelectionBtn.dataset.block = String(bi);
      deleteSelectionBtn.textContent = "✖";
      deleteSelectionBtn.title = "Delete selection or current cell";
      deleteSelectionBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const bounds = getSelectionBounds();
        const hasSelection = bounds && bounds.block === bi;
        
        if (editMode === 'shift' && !hasSelection) {
          // In shift mode without selection, delete entire column
          deleteSelectionOrChar(bi, { allStrings: true, targetRow: cur.stringIdx });
        } else {
          // In other modes or with selection, delete normally
          deleteSelectionOrChar(bi);
        }
      });
      controls.appendChild(deleteSelectionBtn);

      const clearBtn = document.createElement("button");
      clearBtn.className = "block-btn block-btn-equal clipboard-btn";
      clearBtn.dataset.role = "clear";
      clearBtn.dataset.block = String(bi);
      clearBtn.textContent = "—";
      clearBtn.title = "Clear selection or current cell";
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        clearSelectionOrChar(bi);
      });
      controls.appendChild(clearBtn);

      const pasteBtn = document.createElement("button");
      pasteBtn.className = "block-btn block-btn-equal clipboard-btn";
      pasteBtn.dataset.role = "paste";
      pasteBtn.dataset.block = String(bi);
      pasteBtn.textContent = "P";
      pasteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        pasteClipboardIntoBlock(bi);
      });
      controls.appendChild(pasteBtn);

      const copyBtn = document.createElement("button");
      copyBtn.className = "block-btn block-btn-equal clipboard-btn";
      copyBtn.dataset.role = "copy";
      copyBtn.dataset.block = String(bi);
      copyBtn.textContent = "C";
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        copySelectionFromBlock(bi);
      });
      controls.appendChild(copyBtn);

      const moveDownBtn = document.createElement("button");
      moveDownBtn.textContent = "↓";
      moveDownBtn.className = "block-btn block-btn-equal block-btn-bottom";
      moveDownBtn.title = "Move down";
      moveDownBtn.disabled = (bi === blocks.length - 1);
      moveDownBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveBlock(bi, 1);
      });
      controls.appendChild(moveDownBtn);

      blockEl.appendChild(controls);

      // Render tab strings
      for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
        const stringEl = document.createElement("div");
        stringEl.className = "line";
        stringEl.innerHTML = `<span class="label">${tunings[stringIdx]}|</span>`;
        
        const charsContainer = document.createElement("div");
        charsContainer.className = "chars";
        
        for (let col = 0; col < lineLength; col++) {
          const s = document.createElement("span");
          s.className = "ch";
          s.dataset.block = String(bi);
          s.dataset.string = String(stringIdx);
          s.dataset.col = String(col);
          s.textContent = block.data[stringIdx][col];
          s.addEventListener("click", (e) => {
            e.stopPropagation();
            setCursor(bi, stringIdx, col);
            focusKeyboard();
            
            // Show note tooltip if hovering over a digit
            const fret = getFretNumberAtCell(bi, stringIdx, col);
            if (fret !== null) {
              showNoteTooltip(s, stringIdx, fret);
            } else {
              hideNoteTooltip();
            }
          });
          s.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            // Insert vertical bar across all strings at this column
            saveUndoState();
            for (let str = 0; str < 6; str++) {
              blocks[bi].data[str][col] = "|";
            }
            setCursor(bi, stringIdx, col);
            render();
            save();
            focusKeyboard();
          });
          s.addEventListener("mousedown", (e) => handleCellMouseDown(bi, stringIdx, col, e));
          s.addEventListener("touchstart", (e) => handleCellTouchStart(bi, stringIdx, col, e), { passive: true });
          
          charsContainer.appendChild(s);
        }
        
        stringEl.appendChild(charsContainer);
        blockEl.appendChild(stringEl);
      }
    } else if (isTextBlock(block)) {
      // Render text block
      blockEl.className += " text-block";
      
      // Check if this is a single-line text block followed by a tab block
      const isSingleLine = !block.data.includes('\n');
      const nextBlock = blocks[bi + 1];
      const isDocked = isSingleLine && nextBlock && isTabBlock(nextBlock);
      
      if (isDocked) {
        blockEl.className += " docked-text";
      }
      
      if (blocks.length > 1) {
        const controls = document.createElement("div");
        controls.className = "block-controls";
        if (isDocked) controls.classList.add("block-controls-docked");

        const moveUpBtn = document.createElement("button");
        moveUpBtn.textContent = "↑";
        moveUpBtn.className = "block-btn";
        moveUpBtn.title = "Move up";
        moveUpBtn.disabled = (bi === 0);
        moveUpBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveBlock(bi, -1);
        });

        const moveDownBtn = document.createElement("button");
        moveDownBtn.textContent = "↓";
        moveDownBtn.className = "block-btn" + (isDocked ? "" : " block-btn-bottom");
        moveDownBtn.title = "Move down";
        moveDownBtn.disabled = (bi === blocks.length - 1);
        moveDownBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          moveBlock(bi, 1);
        });

        controls.appendChild(moveUpBtn);
        controls.appendChild(moveDownBtn);
        blockEl.appendChild(controls);
      }
      
      const textArea = document.createElement("textarea");
      textArea.className = "text-content";
      textArea.value = block.data;
      textArea.rows = 1;
      textArea.placeholder = "Add a line break to detach this line from the next tab line";
      textArea.setAttribute("spellcheck", "false");
      textArea.setAttribute("autocomplete", "off");
      textArea.setAttribute("autocorrect", "off");
      textArea.setAttribute("autocapitalize", "off");
      textArea.dataset.block = String(bi);
      
      // Auto-resize functionality
      const autoResize = () => {
        if (isDocked) {
          textArea.style.height = '';
          return;
        }
        textArea.style.height = 'auto';
        let minHeight = 28;
        if (!block.data.includes('\n') && !isDocked) {
          minHeight = 42;
        }
        const desired = Math.max(minHeight, textArea.scrollHeight);
        textArea.style.height = `${desired}px`;
      };
      
      let textInputTimeout;
      let previousHadNewline = block.data.includes('\n');
      
      textArea.addEventListener("input", (e) => {
        blocks[bi].data = e.target.value;
        
        // Check if newline state changed (affects docking)
        const currentHasNewline = e.target.value.includes('\n');
        if (currentHasNewline !== previousHadNewline) {
          previousHadNewline = currentHasNewline;
          // Full re-render to update docking state
          render();
          // Re-focus the textarea after render
          setTimeout(() => {
            const newBlockEl = elEditor.children[bi];
            if (newBlockEl) {
              const newTextArea = newBlockEl.querySelector('.text-content');
              if (newTextArea) {
                newTextArea.focus();
                // Restore cursor position
                newTextArea.selectionStart = e.target.selectionStart;
                newTextArea.selectionEnd = e.target.selectionEnd;
              }
            }
          }, 0);
        } else {
          autoResize();
        }
        
        save();
        
        // Debounced undo state saving for text input
        clearTimeout(textInputTimeout);
        textInputTimeout = setTimeout(() => {
          if (!isUndoing) {
            saveUndoState();
          }
        }, 1000); // Save undo state 1 second after user stops typing
      });
      
      textArea.addEventListener("focus", (e) => {
        cur.block = bi;
        cur.stringIdx = 0;
        cur.col = 0;
        updateCursorOnly();
        save();
      });
      
      textArea.addEventListener("click", (e) => {
        e.stopPropagation();
        textArea.focus();
      });

      textArea.addEventListener("keydown", (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          toggleEditMode();
          return;
        }

        if (!isDocked) return;
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

        const caretCol = textArea.selectionStart ?? 0;
        if (e.key === "ArrowDown") {
          const tabIdx = getDockedTabForText(bi);
          if (tabIdx !== -1) {
            e.preventDefault();
            clearSelection();
            resetKeyboardSelectionAnchor();
            if (typeof suppressNextArrowKeyNavigation === "function") {
              suppressNextArrowKeyNavigation();
            }
            focusTabFromDockedText(bi, caretCol, "down");
          }
        } else if (e.key === "ArrowUp") {
          const previousTabIdx = findPreviousTabBlock(bi);
          if (previousTabIdx !== -1) {
            e.preventDefault();
            clearSelection();
            resetKeyboardSelectionAnchor();
            if (typeof suppressNextArrowKeyNavigation === "function") {
              suppressNextArrowKeyNavigation();
            }
            focusTabFromDockedText(bi, caretCol, "up");
          }
        }
      });
      
      // Auto-resize on initial render
      requestAnimationFrame(() => {
        autoResize();
        if (bi === cur.block) {
          textArea.focus();
        }
      });
      
    blockEl.appendChild(textArea);
  }

    const blockRemoveBtn = document.createElement("button");
    blockRemoveBtn.className = "block-remove-handle";
    blockRemoveBtn.type = "button";
    blockRemoveBtn.innerHTML = "&times;";
    blockRemoveBtn.title = "Delete block";
    // Hide if this is the only block
    if (blocks.length === 1) {
      blockRemoveBtn.style.display = "none";
    }
    blockRemoveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteBlock(bi);
    });
    blockEl.appendChild(blockRemoveBtn);
  
  elEditor.appendChild(blockEl);
  });
  
  updateCursorOnly();
  updateSelectionHighlight();
  refreshClipboardButtons();
};
