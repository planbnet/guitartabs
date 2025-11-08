// === Storage and Import/Export ===

// Local Storage
const save = () => {
  const payload = { blocks, lineLength, cur, editMode };
  localStorage.setItem("ascii_tab_editor_v1", JSON.stringify(payload));
};

const load = () => {
  const raw = localStorage.getItem("ascii_tab_editor_v1");
  if (!raw) return false;
  try {
    const payload = JSON.parse(raw);
    if (!payload || !Array.isArray(payload.blocks)) return false;
    
    // Handle legacy format conversion
    if (payload.blocks.length > 0 && Array.isArray(payload.blocks[0])) {
      // Convert old format to new format
      blocks = payload.blocks.map(block => ({ type: 'tab', data: block }));
    } else {
      blocks = payload.blocks;
    }
    
    lineLength = payload.lineLength || DEFAULT_LEN;
    cur = payload.cur || cur;
    editMode = payload.editMode || 'replace';
    return true;
  } catch { return false; }
};

// Export functionality - download current content as .txt file
const exportToFile = () => {
  const content = formatContentForExport();
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = 'guitar-tab.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Format blocks for text export
const formatContentForExport = () => {
  let content = '';
  
  blocks.forEach((block, index) => {
    if (block.type === 'tab') {
      // Tab block formatting
      const strings = ['e|', 'B|', 'G|', 'D|', 'A|', 'E|'];
      for (let i = 0; i < 6; i++) {
        content += strings[i] + block.data[i].join('') + '\n';
      }
      
      // Add empty line after tab blocks (except last one)
      if (index < blocks.length - 1) {
        content += '\n';
      }
    } else if (block.type === 'text') {
      // Text block formatting
      content += block.data + '\n';
      
      // Check if this is a docked text (single-line followed by tab)
      const isSingleLine = !block.data.includes('\n');
      const nextBlock = blocks[index + 1];
      const isDocked = isSingleLine && nextBlock && isTabBlock(nextBlock);
      
      // Add empty line after text blocks, except for docked ones
      if (!isDocked && index < blocks.length - 1) {
        content += '\n';
      }
    }
  });
  
  return content;
};

// Import functionality - read file and parse content
const importFromFile = () => {
  const fileInput = document.getElementById('file-input');
  fileInput.click();
};

// Handle file selection
const handleFileImport = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    const content = e.target.result;
    parseImportedContent(content);
    render();
    save();
  };
  reader.readAsText(file);
  
  // Clear the input so the same file can be selected again
  event.target.value = '';
};

// Import from clipboard
const importFromClipboard = async () => {
  try {
    const content = await navigator.clipboard.readText();
    if (content) {
      parseImportedContent(content);
      render();
      save();
    }
  } catch (err) {
    alert('Failed to read from clipboard. Please grant clipboard permissions or use Import button instead.');
    console.error('Clipboard read failed:', err);
  }
};

// Parse imported text content into blocks
const parseImportedContent = (content) => {
  // Normalize Windows line endings so blank lines are detected correctly
  const normalized = content.replace(/\r/g, '');
  const lines = normalized.split('\n');
  blocks = [];
  cur = { block: 0, stringIdx: 0, col: 0 };
  
  // First pass: find maximum tab line length
  let maxTabLength = lineLength;
  let i = 0;
  while (i < lines.length) {
    if (i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6))) {
      for (let j = 0; j < 6; j++) {
        const tabContent = lines[i + j].substring(2).replace(/\s+$/, '');
        maxTabLength = Math.max(maxTabLength, tabContent.length);
      }
      i += 6;
    } else {
      i++;
    }
  }
  
  // Adjust line length to max tab length (within allowed range)
  lineLength = clamp(maxTabLength, 50, 120);
  document.getElementById("inp-len").value = String(lineLength);
  
  // Second pass: parse blocks
  i = 0;
  while (i < lines.length) {
    // Check if this looks like a tab block
    if (i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6))) {
      // Create tab block
      const tabBlock = { type: 'tab', data: [] };
      for (let j = 0; j < 6; j++) {
        const line = lines[i + j];
        // Remove string indicator, trim trailing whitespace, and convert to character array
        const tabLine = line.substring(2).replace(/\s+$/, '').split('');
        // Pad or trim to current line length
        while (tabLine.length < lineLength) tabLine.push('-');
        if (tabLine.length > lineLength) tabLine.splice(lineLength);
        tabBlock.data.push(tabLine);
      }
      blocks.push(tabBlock);
      i += 6;
    } else {
      // Collect consecutive non-tab lines into text blocks
      const textLines = [];
      
      while (i < lines.length && !(i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6)))) {
        textLines.push(lines[i]);
        i++;
      }
      
      if (textLines.length > 0) {
        // Check if there's a tab block following
        const hasTabAfter = (i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6)));
        
        // Split by empty lines (lines that are empty or only whitespace)
        const groups = [];
        let currentGroup = [];
        let hasEmptySeparator = false; // Track if we've seen an empty line
        
        for (let j = 0; j < textLines.length; j++) {
          if (textLines[j].trim() === '') {
            if (currentGroup.length > 0) {
              groups.push({ lines: currentGroup, hasEmptyAfter: true });
              currentGroup = [];
              hasEmptySeparator = true;
            }
          } else {
            currentGroup.push(textLines[j]);
          }
        }
        
        if (currentGroup.length > 0) {
          // Last group - check if it had empty separator before
          groups.push({ lines: currentGroup, hasEmptyAfter: false });
        }
        
        // Process groups
        for (let g = 0; g < groups.length; g++) {
          const group = groups[g];
          const isLastGroup = (g === groups.length - 1);
          const isSingleLine = (group.lines.length === 1);
          
          // Single line directly before tab with NO empty line = docked
          if (isSingleLine && isLastGroup && hasTabAfter && !group.hasEmptyAfter) {
            blocks.push({ type: 'text', data: group.lines[0] });
          } else if (isSingleLine && group.hasEmptyAfter) {
            // Single line with empty line after = add newline to prevent docking
            blocks.push({ type: 'text', data: group.lines[0] + '\n' });
          } else {
            // Multi-line = regular text block
            blocks.push({ type: 'text', data: group.lines.join('\n') });
          }
        }
      }
    }
  }
  
  // Ensure we have at least one block
  if (blocks.length === 0) {
    blocks.push(makeEmptyBlock(lineLength));
  }
};

// Check if 6 lines form a valid tab block (renamed to avoid conflict)
const isTabSequence = (lines) => {
  if (lines.length !== 6) return false;
  
  const expectedPrefixes = ['e|', 'B|', 'G|', 'D|', 'A|', 'E|'];
  return lines.every((line, index) => 
    line.length >= 2 && line.substring(0, 2) === expectedPrefixes[index]
  );
};
