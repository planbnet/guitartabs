// === Keyboard Event Handling ===

// DOM elements
const elKbd = document.getElementById("kbd");

// Focus keyboard for iPad
const focusKeyboard = () => {
  if (!elKbd) return;
  elKbd.focus({ preventScroll: true });
};

let suppressNextArrowNavigation = false;
const suppressNextArrowKeyNavigation = () => {
  suppressNextArrowNavigation = true;
  setTimeout(() => {
    suppressNextArrowNavigation = false;
  }, 0);
};

// Check if key is printable
const isPrintable = (e) => {
  // Allow single characters even with Alt key (needed for special chars on Mac/international keyboards)
  // But exclude Ctrl and Meta (Cmd) combinations
  if (e.ctrlKey || e.metaKey) return false;
  const key = e.key;
  if (key.length === 1) return true;
  return false;
};

// Main keyboard event handler
const onKeyDown = (e) => {
  if (suppressNextArrowNavigation && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    suppressNextArrowNavigation = false;
    return;
  }

  // Don't intercept keyboard events when a textarea is focused
  if (document.activeElement && (
    document.activeElement.classList.contains('text-content') ||
    document.activeElement.classList.contains('text-modal-area')
  )) {
    return;
  }

  if (isPrintable(e)) {
    e.preventDefault();
    hidePopover();
    handlePrintable(e.key, e.shiftKey);
    return;
  }
  
  // Ctrl+Z or Cmd+Z for undo (Cmd on Mac, Ctrl on Windows/Linux)
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    undo();
    return;
  }
  
  // Ctrl+C or Cmd+C for copy
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
    if (isTabBlock(blocks[cur.block])) {
      const bounds = getSelectionBounds();
      if (bounds && bounds.block === cur.block) {
        e.preventDefault();
        copySelectionFromBlock(cur.block);
      }
    }
    return;
  }
  
  // Ctrl+X or Cmd+X for cut (copy then clear)
  if ((e.ctrlKey || e.metaKey) && e.key === 'x') {
    if (isTabBlock(blocks[cur.block])) {
      const bounds = getSelectionBounds();
      if (bounds && bounds.block === cur.block) {
        e.preventDefault();
        copySelectionFromBlock(cur.block);
        clearSelectionOrChar(cur.block);
      }
    }
    return;
  }
  
  // Ctrl+V or Cmd+V for paste
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
    if (isTabBlock(blocks[cur.block]) && hasClipboardData()) {
      e.preventDefault();
      pasteClipboardIntoBlock(cur.block);
    }
    return;
  }
  
  const handleDirectionalMove = (dBlock, dString, dCol) => {
    if (e.shiftKey && isTabBlock(blocks[cur.block])) {
      e.preventDefault();
      startKeyboardSelection();
      moveCursor(dBlock, dString, dCol);
      updateKeyboardSelection();
    } else {
      e.preventDefault();
      clearSelection();
      resetKeyboardSelectionAnchor();
      
      // Smart cursor movement with tab block jumping
      if (!isTabBlock(blocks[cur.block])) {
        moveCursor(dBlock, dString, dCol);
        return;
      }

      if (dString === -1 && cur.stringIdx === 0) {
        const dockedTextIdx = getDockedTextBeforeTab(cur.block);
        if (dockedTextIdx !== -1) {
          focusDockedTextLine(dockedTextIdx, cur.col);
          return;
        }
      }
      
      // Handle right arrow at the end of line
      if (dCol === 1 && cur.col === lineLength - 1) {
        // Find next tab block
        for (let i = cur.block + 1; i < blocks.length; i++) {
          if (isTabBlock(blocks[i])) {
            setCursor(i, cur.stringIdx, 0);
            return;
          }
        }
      }
      
      // Handle left arrow at the start of line
      if (dCol === -1 && cur.col === 0) {
        // Find previous tab block
        for (let i = cur.block - 1; i >= 0; i--) {
          if (isTabBlock(blocks[i])) {
            setCursor(i, cur.stringIdx, lineLength - 1);
            return;
          }
        }
      }
      
      // Handle up arrow at the top string
      if (dString === -1 && cur.stringIdx === 0) {
        // Find previous tab block
        for (let i = cur.block - 1; i >= 0; i--) {
          if (isTabBlock(blocks[i])) {
            setCursor(i, 5, cur.col);
            return;
          }
        }
      }
      
      // Handle down arrow at the bottom string
      if (dString === 1 && cur.stringIdx === 5) {
        // Find next tab block
        for (let i = cur.block + 1; i < blocks.length; i++) {
          if (isTabBlock(blocks[i])) {
            setCursor(i, 0, cur.col);
            return;
          }
        }
      }
      
      // Normal movement within current block
      moveCursor(dBlock, dString, dCol);
    }
    hidePopover();
  };

  switch (e.key) {
    case "ArrowLeft": handleDirectionalMove(0, 0, -1); break;
    case "ArrowRight": handleDirectionalMove(0, 0, +1); break;
    case "ArrowUp": handleDirectionalMove(0, -1, 0); break;
    case "ArrowDown": handleDirectionalMove(0, +1, 0); break;
    case "Tab":
      e.preventDefault();
      hidePopover();
      toggleEditMode();
      break;
    case "Backspace":
      e.preventDefault();
      hidePopover();
      if (isTabBlock(blocks[cur.block])) {
        const bounds = getSelectionBounds();
        const hasSelection = bounds && bounds.block === cur.block;
        
        if (editMode === 'shift') {
          if (hasSelection) {
            deleteSelectionOrChar(cur.block);
          } else if (cur.col > 0) {
            // Move left first, then delete at that position
            setCursor(cur.block, cur.stringIdx, cur.col - 1);
            deleteSelectionOrChar(cur.block, { allStrings: true, targetRow: cur.stringIdx });
          }
        } else if (editMode === 'insert') {
          if (hasSelection) {
            deleteSelectionOrChar(cur.block);
          } else if (cur.col > 0) {
            // Check if Shift key is pressed to force full line shift
            const forceFullLine = e.shiftKey;
            setCursor(cur.block, cur.stringIdx, cur.col - 1);
            if (typeof smartDeleteCharacter === 'function') {
              smartDeleteCharacter('backward', forceFullLine);
            } else {
              deleteSelectionOrChar(cur.block, { rows: [cur.stringIdx] });
            }
          }
        } else {
          // Replace mode: clear current char and move left
          if (hasSelection) {
            clearSelectionOrChar(cur.block);
          } else {
            saveUndoState();
            if (blocks[cur.block].data[cur.stringIdx][cur.col] === "|") {
              clearVerticalBar(cur.block, cur.col);
            } else {
              blocks[cur.block].data[cur.stringIdx][cur.col] = "-";
            }
            render();
            save();
          }
          const newCol = Math.max(0, cur.col - 1);
          setCursor(cur.block, cur.stringIdx, newCol);
        }
      }
      break;
    case "Delete":
      e.preventDefault();
      hidePopover();
      if (isTabBlock(blocks[cur.block])) {
        const bounds = getSelectionBounds();
        const hasSelection = bounds && bounds.block === cur.block;
        
        if (editMode === 'shift' && !hasSelection) {
          // In shift mode without selection, delete entire column
          deleteSelectionOrChar(cur.block, { allStrings: true, targetRow: cur.stringIdx });
        } else if (editMode === 'insert' && !hasSelection) {
          // In insert mode, use smart delete
          const forceFullLine = e.shiftKey;
          if (typeof smartDeleteCharacter === 'function') {
            smartDeleteCharacter('forward', forceFullLine);
          } else {
            deleteSelectionOrChar(cur.block);
          }
        } else {
          // In other modes or with selection, delete normally
          deleteSelectionOrChar(cur.block);
        }
      }
      break;
    case "Home": e.preventDefault(); setCursor(cur.block, cur.stringIdx, 0); hidePopover(); break;
    case "End": e.preventDefault(); setCursor(cur.block, cur.stringIdx, lineLength - 1); hidePopover(); break;
    case "Insert": e.preventDefault(); toggleEditMode(); break;
    case "Enter":
      // Enter inserts a bar at column and moves to next string (quick annotate)
      e.preventDefault();
      insertBarAtCursor();
      moveCursor(0, +1, 0);
      break;
  }
};

const jumpToNextBarOrBlock = () => {
  if (!isTabBlock(blocks[cur.block])) return;
  const block = blocks[cur.block];
  for (let col = cur.col + 1; col < lineLength; col++) {
    if (block.data[cur.stringIdx][col] === "|") {
      setCursor(cur.block, cur.stringIdx, col);
      return;
    }
  }
  for (let nextBlock = cur.block + 1; nextBlock < blocks.length; nextBlock++) {
    if (isTabBlock(blocks[nextBlock])) {
      setCursor(nextBlock, cur.stringIdx, 0);
      return;
    }
  }
};
