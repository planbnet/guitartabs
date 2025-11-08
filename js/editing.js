// === Tab Editing Logic and Operations ===

// Clear vertical bar across all strings at given column
const clearVerticalBar = (blockIndex, col) => {
  if (!isTabBlock(blocks[blockIndex])) return;
  for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
    blocks[blockIndex].data[stringIdx][col] = "-";
  }
};

// Find next vertical bar position in a string row after given column
const findNextBar = (blockIdx, stringIdx, fromCol) => {
  if (!isTabBlock(blocks[blockIdx])) return -1;
  const row = blocks[blockIdx].data[stringIdx];
  for (let i = fromCol + 1; i < lineLength; i++) {
    if (row[i] === '|') return i;
  }
  return -1;
};

// Find previous vertical bar position in a string row before given column
const findPreviousBar = (blockIdx, stringIdx, toCol) => {
  if (!isTabBlock(blocks[blockIdx])) return -1;
  const row = blocks[blockIdx].data[stringIdx];
  for (let i = toCol - 1; i >= 0; i--) {
    if (row[i] === '|') return i;
  }
  return -1;
};

// Check if a vertical bar at given column spans all 6 strings
const isFullVerticalBar = (blockIdx, col) => {
  if (!isTabBlock(blocks[blockIdx])) return false;
  const block = blocks[blockIdx];
  for (let i = 0; i < 6; i++) {
    if (block.data[i][col] !== '|') return false;
  }
  return true;
};

// Check if section between cursor and next bar has room (at least one dash)
const canShiftToNextBar = (blockIdx, stringIdx, fromCol, toCol) => {
  if (!isTabBlock(blocks[blockIdx])) return false;
  const row = blocks[blockIdx].data[stringIdx];
  for (let i = fromCol; i < toCol; i++) {
    if (row[i] === '-') return true;
  }
  return false;
};

// Toggle edit mode between replace, shift, and insert
const toggleEditMode = () => {
  saveUndoState();
  if (editMode === 'replace') {
    editMode = 'shift';
  } else if (editMode === 'shift') {
    editMode = 'insert';
  } else {
    editMode = 'replace';
  }
  const btn = document.getElementById("btn-mode-toggle");
  if (editMode === 'shift') {
    btn.textContent = "Shift";
    btn.classList.remove('insert-mode');
    btn.classList.add('shift-mode');
  } else if (editMode === 'insert') {
    btn.textContent = "Insert";
    btn.classList.remove('shift-mode');
    btn.classList.add('insert-mode');
  } else {
    btn.textContent = "Replace";
    btn.classList.remove('insert-mode', 'shift-mode');
  }
  save();
  if (typeof focusKeyboard === "function") {
    focusKeyboard();
  }
};

// Smart insert for insert mode - shifts only to next bar if possible
const smartInsertCharacter = (ch, forceFullLine = false) => {
  if (!isTabBlock(blocks[cur.block])) return;
  clearSelection();
  
  const blockIdx = cur.block;
  const stringIdx = cur.stringIdx;
  const col = cur.col;
  const block = blocks[blockIdx];
  const row = block.data[stringIdx];
  const cursorOnFullBar = row[col] === "|" && isFullVerticalBar(blockIdx, col);
  
  if (forceFullLine || cursorOnFullBar) {
    saveUndoState();
    // Preserve multi-string bars by shifting the whole line when writing on them
    insertCharacterAtCursor(ch, { forceFullLine: true });
    return;
  }
  
  // Find next bar
  const nextBarCol = findNextBar(blockIdx, stringIdx, col);
  
  // Determine if we should shift only to next bar or the whole line
  let shiftToBar = false;
  if (!forceFullLine && nextBarCol !== -1) {
    // Check if the bar is full (spans all 6 strings)
    const isBarAligned = isFullVerticalBar(blockIdx, nextBarCol);
    // Check if there's room to shift
    const hasRoom = canShiftToNextBar(blockIdx, stringIdx, col, nextBarCol);
    
    if (isBarAligned && hasRoom) {
      shiftToBar = true;
    }
  }
  
  saveUndoState();
  
  if (shiftToBar) {
    // Check if we would lose content at the position before the bar
    const charBeforeBar = row[nextBarCol - 1];
    if (charBeforeBar !== '-' && charBeforeBar !== '|') {
      // Content would be lost, shift whole line instead
      insertCharacterAtCursor(ch);
      return;
    }
    
    // Shift only to next bar
    for (let i = nextBarCol - 1; i > col; i--) {
      row[i] = row[i - 1];
    }
    row[col] = ch;
  } else {
    // Shift whole line (use existing logic)
    insertCharacterAtCursor(ch);
    return;
  }
  
  // Advance cursor
  if (cur.col < lineLength - 1) {
    setCursor(cur.block, cur.stringIdx, cur.col + 1);
  }
  
  render();
  save();
};

// Delete with smart shifting for insert mode
const smartDeleteCharacter = (direction = 'forward', forceFullLine = false) => {
  if (!isTabBlock(blocks[cur.block])) return;
  
  const blockIdx = cur.block;
  const stringIdx = cur.stringIdx;
  const col = cur.col;
  const block = blocks[blockIdx];
  const row = block.data[stringIdx];
  
  // Determine shift range
  let shiftToBar = false;
  let targetBarCol = -1;
  
  if (!forceFullLine) {
    if (direction === 'forward') {
      // Delete key - shift from next bar
      targetBarCol = findNextBar(blockIdx, stringIdx, col);
    } else {
      // Backspace - shift from previous bar (or beginning if no previous bar)
      targetBarCol = findPreviousBar(blockIdx, stringIdx, col);
    }
    
    if (direction === 'forward' && targetBarCol !== -1) {
      // For delete, only shift to bar if bar is aligned
      const isBarAligned = isFullVerticalBar(blockIdx, targetBarCol);
      if (isBarAligned) {
        shiftToBar = true;
      }
    } else if (direction === 'backward') {
      // For backspace, we can always do smart shift
      // If there's a previous bar, check if it's aligned
      // If no previous bar, we're in the first section - still do smart shift
      if (targetBarCol !== -1) {
        const isBarAligned = isFullVerticalBar(blockIdx, targetBarCol);
        if (isBarAligned) {
          shiftToBar = true;
        }
      } else {
        // No previous bar - we're in the first section, still do smart shift to next bar
        shiftToBar = true;
        targetBarCol = -1; // Will be handled specially below
      }
    }
  }
  
  if (shiftToBar && direction === 'forward' && targetBarCol !== -1) {
    // Delete: shift left only content between cursor and next bar
    saveUndoState();
    for (let i = col; i < targetBarCol - 1; i++) {
      row[i] = row[i + 1];
    }
    row[targetBarCol - 1] = '-';
    render();
    save();
  } else if (shiftToBar && direction === 'backward') {
    // Backspace: shift left only content between start of section and next bar
    // Find where the current section ends (next bar or end of line)
    const sectionEnd = findNextBar(blockIdx, stringIdx, col);
    const endCol = sectionEnd !== -1 ? sectionEnd : lineLength;
    
    saveUndoState();
    // Shift content from col to endCol leftward by 1
    for (let i = col; i < endCol - 1; i++) {
      row[i] = row[i + 1];
    }
    // Add dash at the position before the end marker
    if (sectionEnd !== -1) {
      row[sectionEnd - 1] = '-';
    } else {
      row[lineLength - 1] = '-';
    }
    render();
    save();
  } else {
    // Use normal delete for whole line
    deleteSelectionOrChar(blockIdx, { rows: [stringIdx] });
  }
};

// Insert character and shift content right with cascading overflow
const insertCharacterAtCursor = (ch, options = {}) => {
  if (!isTabBlock(blocks[cur.block])) return;
  clearSelection();
  
  const { forceFullLine = false } = options;
  const startBlock = cur.block;
  const col = cur.col;
  const currentBlock = blocks[startBlock];
  
  const rowsToShift = forceFullLine
    ? [0, 1, 2, 3, 4, 5]
    : (editMode === 'insert'
      ? [cur.stringIdx]
      : [0, 1, 2, 3, 4, 5]);
  const uniqueRows = Array.from(new Set(rowsToShift.map(row => clamp(row, 0, 5))));
  if (uniqueRows.length === 0) uniqueRows.push(cur.stringIdx);
  
  // Collect what will be shifted off the end of the current block
  let overflow = [];
  uniqueRows.forEach((stringIdx) => {
    const lastChar = currentBlock.data[stringIdx][lineLength - 1];
    // Only consider non-dash and non-bar characters as meaningful content
    if (lastChar !== '-' && lastChar !== '|') {
      overflow.push({ stringIdx, char: lastChar });
    }
  });
  
  // Shift content right on relevant strings from cursor position in current block
  uniqueRows.forEach((stringIdx) => {
    for (let i = lineLength - 1; i > col; i--) {
      currentBlock.data[stringIdx][i] = currentBlock.data[stringIdx][i - 1];
    }
    // For full-tab shift, fill the insertion position on other strings with dashes
    if (uniqueRows.length === 6 && stringIdx !== cur.stringIdx) {
      currentBlock.data[stringIdx][col] = '-';
    }
  });
  
  // If overwriting a vertical bar, clear the entire column first
  if (currentBlock.data[cur.stringIdx][col] === "|") {
    clearVerticalBar(cur.block, col);
  }
  
  // Insert the new character at cursor position
  currentBlock.data[cur.stringIdx][col] = ch;
  
  // Handle overflow by cascading through existing tab blocks
  let currentBlockIndex = startBlock;
  while (overflow.length > 0 && currentBlockIndex < blocks.length) {
    // Check if next block exists and is a tab block
    const nextBlockIndex = currentBlockIndex + 1;
    
    if (nextBlockIndex < blocks.length && isTabBlock(blocks[nextBlockIndex])) {
      // Cascade into existing next block
      const nextBlock = blocks[nextBlockIndex];
      const nextOverflow = [];
      
      // Collect what will be shifted off the end of next block
      uniqueRows.forEach((stringIdx) => {
        const lastChar = nextBlock.data[stringIdx][lineLength - 1];
        if (lastChar !== '-' && lastChar !== '|') {
          nextOverflow.push({ stringIdx, char: lastChar });
        }
        for (let i = lineLength - 1; i > 0; i--) {
          nextBlock.data[stringIdx][i] = nextBlock.data[stringIdx][i - 1];
        }
        nextBlock.data[stringIdx][0] = '-';
      });
      
      // Place overflow content at the beginning of next block
      overflow.forEach(({ stringIdx, char }) => {
        nextBlock.data[stringIdx][0] = char;
      });
      
      // Continue with any new overflow
      overflow = nextOverflow;
      currentBlockIndex = nextBlockIndex;
    } else {
      // Need to create a new block for remaining overflow
      if (overflow.length > 0) {
        const newBlock = makeEmptyBlock(lineLength);
        // Place overflow content at the beginning of the new line
        overflow.forEach(({ stringIdx, char }) => {
          newBlock.data[stringIdx][0] = char;
        });
        blocks.splice(nextBlockIndex, 0, newBlock);
      }
      break;
    }
  }
  
  // Advance cursor
  if (cur.col < lineLength - 1) {
    setCursor(cur.block, cur.stringIdx, cur.col + 1);
  } else {
    setCursor(cur.block, cur.stringIdx, cur.col);
  }
  
  // Re-render and save (only for insert mode)
  render();
  save();
};

// Handle printable character input
const handlePrintable = (ch, shiftKeyPressed = false) => {
  // Only handle printable for tab blocks
  if (!isTabBlock(blocks[cur.block])) return;
  
  saveUndoState();
  clearSelection();
  
  // Convert space to dash to maintain tab line consistency
  const charToInsert = ch === ' ' ? '-' : ch;
  
  // Special handling for | character - create full vertical bar
  if (charToInsert === '|') {
    // Insert vertical bar across all strings at current column
    for (let s = 0; s < 6; s++) {
      blocks[cur.block].data[s][cur.col] = "|";
    }
    // Advance cursor
    if (cur.col < lineLength - 1) {
      setCursor(cur.block, cur.stringIdx, cur.col + 1);
    } else {
      setCursor(cur.block, cur.stringIdx, cur.col);
    }
    render();
    save();
    return;
  }
  
  if (editMode === 'shift') {
    // Shift mode: shift entire column
    insertCharacterAtCursor(charToInsert);
  } else if (editMode === 'insert') {
    // Insert mode: use smart insert (shift to next bar if possible)
    // If Shift key is pressed, force full line shift
    if (shiftKeyPressed) {
      insertCharacterAtCursor(charToInsert);
    } else {
      smartInsertCharacter(charToInsert);
    }
  } else {
    // Overwrite mode: replace current character
    // If overwriting a vertical bar, clear the entire column first
    if (blocks[cur.block].data[cur.stringIdx][cur.col] === "|") {
      clearVerticalBar(cur.block, cur.col);
    }
    
    // replace current char, advance cursor
    blocks[cur.block].data[cur.stringIdx][cur.col] = charToInsert;
    if (cur.col < lineLength - 1) {
      setCursor(cur.block, cur.stringIdx, cur.col + 1);
    } else if (cur.block < blocks.length - 1) {
      setCursor(cur.block + 1, cur.stringIdx, 0);
    } else {
      setCursor(cur.block, cur.stringIdx, cur.col);
    }
    render();
    save();
  }
};

// Commands
const insertBarAtCursor = () => {
  if (!isTabBlock(blocks[cur.block])) return;
  saveUndoState();
  clearSelection();
  for (let s = 0; s < 6; s++) {
    blocks[cur.block].data[s][cur.col] = "|";
  }
  render();
  save();
};

const newLineBlock = () => {
  saveUndoState();
  clearSelection();
  blocks.splice(cur.block + 1, 0, makeEmptyBlock(lineLength));
  setCursor(cur.block + 1, 0, 0);
  render();
  save();
};

const newTextBlock = () => {
  saveUndoState();
  clearSelection();
  blocks.splice(cur.block + 1, 0, makeTextBlock());
  setCursor(cur.block + 1, 0, 0);
  render();
  save();
};

const deleteBlock = (blockIndex) => {
  if (blocks.length <= 1) return; // Don't delete if it's the only block
  saveUndoState();
  blocks.splice(blockIndex, 1);
  clearSelection();
  
  // Adjust cursor if necessary
  if (cur.block >= blocks.length) {
    cur.block = blocks.length - 1;
  } else if (cur.block >= blockIndex && cur.block > 0) {
    cur.block--;
  }
  
  // Ensure cursor is within valid bounds
  cur.stringIdx = clamp(cur.stringIdx, 0, 5);
  cur.col = clamp(cur.col, 0, lineLength - 1);
  
  render();
  save();
};

const moveBlock = (blockIndex, direction) => {
  const newIndex = blockIndex + direction;
  
  // Check bounds
  if (newIndex < 0 || newIndex >= blocks.length) return;
  
  saveUndoState();
  clearSelection();
  
  // Swap blocks
  const temp = blocks[blockIndex];
  blocks[blockIndex] = blocks[newIndex];
  blocks[newIndex] = temp;
  
  // Adjust cursor if it was on the moved block
  if (cur.block === blockIndex) {
    cur.block = newIndex;
  } else if (cur.block === newIndex) {
    cur.block = blockIndex;
  }
  
  render();
  save();
};

const applyLength = (L) => {
  saveUndoState();
  clearSelection();
  L = clamp(L|0, 50, 120);
  // Resize each tab block to new length
  blocks = blocks.map(block => {
    if (isTabBlock(block)) {
      return {
        type: 'tab',
        data: block.data.map(arr => {
          const out = new Array(L).fill("-");
          for (let i = 0; i < Math.min(arr.length, L); i++) out[i] = arr[i];
          return out;
        })
      };
    }
    return block; // text blocks unchanged
  });
  lineLength = L;
  cur.col = clamp(cur.col, 0, lineLength - 1);
  render();
  save();
};

const clearAll = () => {
  if (!confirm("Clear all lines?")) return;
  saveUndoState();
  clearSelection();
  blocks = [makeEmptyBlock(lineLength)];
  setCursor(0, 0, 0);
  render();
  save();
};

const shiftBlockForInsert = (block, startCol, width, rows = null) => {
  if (width <= 0) return;
  const rowsToShift = rows && rows.length
    ? Array.from(new Set(rows.map(row => clamp(row, 0, 5))))
    : [0, 1, 2, 3, 4, 5];
  rowsToShift.forEach((stringIdx) => {
    for (let i = lineLength - 1; i >= startCol + width; i--) {
      block.data[stringIdx][i] = block.data[stringIdx][i - width];
    }
    for (let i = startCol; i < Math.min(lineLength, startCol + width); i++) {
      block.data[stringIdx][i] = "-";
    }
  });
};

const deleteSelectionOrChar = (blockIndex, options = {}) => {
  if (!isTabBlock(blocks[blockIndex])) return;
  const bounds = getSelectionBounds();
  let rows = [];
  let startCol;
  let width;

  if (bounds && bounds.block === blockIndex && !options.ignoreSelection) {
    startCol = bounds.startCol;
    width = bounds.endCol - bounds.startCol + 1;
    for (let s = bounds.startString; s <= bounds.endString; s++) rows.push(s);
  } else {
    if (cur.block !== blockIndex) {
      setCursor(blockIndex, 0, 0);
    }
    startCol = cur.col;
    width = 1;
    if (options.allStrings) {
      rows = [0, 1, 2, 3, 4, 5];
    } else if (options.rows && options.rows.length) {
      rows = options.rows.map(r => clamp(r, 0, 5));
    } else {
      rows = [cur.stringIdx];
    }
  }

  if (rows.length === 0) rows = [cur.stringIdx];

  startCol = clamp(startCol, 0, lineLength - 1);
  width = clamp(width, 1, lineLength - startCol);
  if (width <= 0) return;

  saveUndoState();
  const targetBlock = blocks[blockIndex];
  rows.forEach((stringIdx) => {
    const row = targetBlock.data[stringIdx];
    for (let c = startCol; c < lineLength - width; c++) {
      row[c] = row[c + width];
    }
    for (let c = Math.max(lineLength - width, 0); c < lineLength; c++) {
      row[c] = "-";
    }
  });

  render();
  setCursor(
    blockIndex,
    clamp(options.targetRow ?? rows[0], 0, 5),
    clamp(startCol, 0, lineLength - 1)
  );
  clearSelection();
  save();
};

const copySelectionFromBlock = (blockIndex) => {
  if (!isTabBlock(blocks[blockIndex])) return;
  const bounds = getSelectionBounds();
  if (!bounds || bounds.block !== blockIndex) return;
  const width = bounds.endCol - bounds.startCol + 1;
  const height = bounds.endString - bounds.startString + 1;
  const payload = [];
  for (let stringIdx = bounds.startString; stringIdx <= bounds.endString; stringIdx++) {
    payload.push(blocks[blockIndex].data[stringIdx].slice(bounds.startCol, bounds.startCol + width));
  }
  setClipboardData({ width, height, data: payload });
  clearSelection();
};

const pasteClipboardIntoBlock = (blockIndex) => {
  if (!isTabBlock(blocks[blockIndex])) return;
  if (cur.block !== blockIndex) return;
  const clipboard = getClipboardData();
  if (!clipboard) return;
  const startRow = clipboard.height === 6 ? 0 : clamp(cur.stringIdx, 0, 5);
  const maxRows = Math.min(clipboard.height, 6 - startRow);
  const startCol = clamp(cur.col, 0, lineLength - 1);
  const maxCols = Math.min(clipboard.width, lineLength - startCol);
  if (maxRows <= 0 || maxCols <= 0) return;
  
  saveUndoState();
  const targetBlock = blocks[blockIndex];
  const pastingFullTab = clipboard.height === 6;
  if (editMode === 'shift' || pastingFullTab) {
    shiftBlockForInsert(targetBlock, startCol, maxCols);
  } else if (editMode === 'insert') {
    const rowsToShift = [];
    for (let r = 0; r < maxRows; r++) {
      rowsToShift.push(startRow + r);
    }
    shiftBlockForInsert(targetBlock, startCol, maxCols, rowsToShift);
  }
  
  for (let r = 0; r < maxRows; r++) {
    const targetString = startRow + r;
    const sourceRow = clipboard.data[r] || [];
    for (let c = 0; c < maxCols; c++) {
      const ch = sourceRow[c] ?? "-";
      targetBlock.data[targetString][startCol + c] = ch;
    }
  }
  
  clearSelection();
  const newCol = Math.min(lineLength - 1, startCol + maxCols - 1);
  setCursor(blockIndex, startRow, newCol);
  render();
  save();
};
const clearSelectionOrChar = (blockIndex) => {
  if (!isTabBlock(blocks[blockIndex])) return;
  const bounds = getSelectionBounds();
  let startString, endString, startCol, width;

  if (bounds && bounds.block === blockIndex) {
    startString = bounds.startString;
    endString = bounds.endString;
    startCol = bounds.startCol;
    width = bounds.endCol - bounds.startCol + 1;
  } else {
    if (cur.block !== blockIndex) {
      setCursor(blockIndex, 0, 0);
    }
    startString = cur.stringIdx;
    endString = cur.stringIdx;
    startCol = cur.col;
    width = 1;
  }

  startCol = clamp(startCol, 0, lineLength - 1);
  width = clamp(width, 1, lineLength - startCol);
  if (width <= 0) return;

  saveUndoState();
  const targetBlock = blocks[blockIndex];
  for (let stringIdx = startString; stringIdx <= endString; stringIdx++) {
    const row = targetBlock.data[stringIdx];
    for (let c = startCol; c < startCol + width && c < lineLength; c++) {
      row[c] = "-";
    }
  }

  // Clear selection while keeping cursor at its current position
  clearSelection();
  render();
  save();
};
