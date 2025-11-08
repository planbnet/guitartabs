// === Keyboard Event Handling ===

// DOM elements
const elKbd = document.getElementById("kbd");

// Focus keyboard for iPad
const focusKeyboard = () => {
  if (!elKbd) return;
  elKbd.focus();
};

// Check if key is printable
const isPrintable = (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  const key = e.key;
  if (key.length === 1) return true;
  return false;
};

// Main keyboard event handler
const onKeyDown = (e) => {
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
    handlePrintable(e.key);
    return;
  }
  
  // Ctrl+Z for undo
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
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
      jumpToNextBarOrBlock();
      break;
    case "Backspace":
      e.preventDefault();
      hidePopover();
      if (isTabBlock(blocks[cur.block])) {
        const bounds = getSelectionBounds();
        const hasSelection = bounds && bounds.block === cur.block;
        const moveLeft = () => {
          const newCol = Math.max(0, cur.col - 1);
          setCursor(cur.block, cur.stringIdx, newCol);
        };
        if (editMode === 'shift') {
          if (hasSelection) {
            deleteSelectionOrChar(cur.block);
          } else {
            deleteSelectionOrChar(cur.block, { allStrings: true, targetRow: cur.stringIdx });
          }
          moveLeft();
        } else if (editMode === 'insert') {
          if (hasSelection) {
            deleteSelectionOrChar(cur.block);
          } else {
            deleteSelectionOrChar(cur.block, { rows: [cur.stringIdx] });
          }
          moveLeft();
        } else {
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
          moveLeft();
        }
      }
      break;
    case "Delete":
      e.preventDefault();
      hidePopover();
      if (isTabBlock(blocks[cur.block])) {
        deleteSelectionOrChar(cur.block);
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
