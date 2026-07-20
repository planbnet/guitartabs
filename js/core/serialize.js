// Text (de)serialization: the ASCII tab format used for export, import,
// Dropbox files and the share/text dialog. Pure functions only.

import { STRING_COUNT, STRING_LABELS, MIN_LEN, MAX_LEN } from "./constants.js";
import { clamp, isTabBlock, isDockedTextBlock, makeEmptyBlock } from "./model.js";

// Six consecutive lines starting with "e|", "B|", ... form a tab block.
export const isTabSequence = (lines) => {
  if (lines.length !== STRING_COUNT) return false;
  return lines.every(
    (line, i) => line.length >= 2 && line.substring(0, 2) === STRING_LABELS[i]
  );
};

export const formatContentForExport = (blocks) => {
  let content = "";

  blocks.forEach((block, index) => {
    if (isTabBlock(block)) {
      for (let i = 0; i < STRING_COUNT; i++) {
        content += STRING_LABELS[i] + block.data[i].join("") + "\n";
      }
      if (index < blocks.length - 1) content += "\n";
    } else {
      content += block.data + "\n";
      // Docked lines stay attached to their tab — no blank line after them.
      if (!isDockedTextBlock(blocks, index) && index < blocks.length - 1) {
        content += "\n";
      }
    }
  });

  return content;
};

// Parse ASCII tab text into blocks. Returns {blocks, lineLength}; never
// mutates anything. lineLength grows to fit the widest imported tab line
// (clamped to the allowed range), starting from `currentLineLength`.
export const parseImportedContent = (content, currentLineLength) => {
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks = [];

  // First pass: find the widest tab line.
  let maxTabLength = currentLineLength;
  let i = 0;
  while (i < lines.length) {
    if (i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6))) {
      for (let j = 0; j < STRING_COUNT; j++) {
        const tabContent = lines[i + j].substring(2).replace(/\s+$/, "");
        maxTabLength = Math.max(maxTabLength, tabContent.length);
      }
      i += STRING_COUNT;
    } else {
      i++;
    }
  }
  const lineLength = clamp(maxTabLength, MIN_LEN, MAX_LEN);

  // Second pass: build blocks.
  i = 0;
  while (i < lines.length) {
    if (i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6))) {
      const tabBlock = { type: "tab", data: [] };
      for (let j = 0; j < STRING_COUNT; j++) {
        const tabLine = lines[i + j].substring(2).replace(/\s+$/, "").split("");
        while (tabLine.length < lineLength) tabLine.push("-");
        if (tabLine.length > lineLength) tabLine.splice(lineLength);
        tabBlock.data.push(tabLine);
      }
      blocks.push(tabBlock);
      i += STRING_COUNT;
      continue;
    }

    // Collect consecutive non-tab lines into text blocks.
    const textLines = [];
    while (i < lines.length && !(i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6)))) {
      textLines.push(lines[i]);
      i++;
    }
    if (textLines.length === 0) continue;

    while (textLines.length > 0 && textLines[0].trim() === "") {
      textLines.shift();
    }

    const hasTabAfter = i + 5 < lines.length && isTabSequence(lines.slice(i, i + 6));

    // The last line before a tab becomes a docked line when it stands alone
    // (i.e. the line before it is blank, or it is the only line).
    let dockedLine = null;
    if (hasTabAfter && textLines.length >= 1) {
      while (textLines.length > 0 && textLines[textLines.length - 1].trim() === "") {
        textLines.pop();
      }
      if (textLines.length > 0) {
        const standsAlone =
          textLines.length === 1 || textLines[textLines.length - 2].trim() === "";
        if (standsAlone) {
          dockedLine = textLines.pop();
          while (textLines.length > 0 && textLines[textLines.length - 1].trim() === "") {
            textLines.pop();
          }
        }
      }
    } else {
      while (textLines.length > 0 && textLines[textLines.length - 1].trim() === "") {
        textLines.pop();
      }
    }

    if (textLines.length > 0) {
      blocks.push({ type: "text", data: textLines.join("\n") });
    }
    if (dockedLine !== null) {
      blocks.push({ type: "text", data: dockedLine });
    }
  }

  if (blocks.length === 0) {
    blocks.push(makeEmptyBlock(lineLength));
  }

  return { blocks, lineLength };
};

// Best-effort title from exported content (first standalone line).
export const extractTitle = (content) => {
  if (!content) return null;
  const lines = content.split("\n");

  if (lines.length >= 2 && lines[0].trim() !== "" && lines[1].trim() === "") {
    return lines[0].trim();
  }
  if (lines.length >= 2 && lines[0].trim() !== "" && isTabSequence(lines.slice(1, 7))) {
    return lines[0].trim();
  }
  if (lines.length > 0 && lines[0].trim() !== "") {
    return lines[0].trim();
  }
  return null;
};

export const sanitizeFilename = (filename) =>
  filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200) || "guitar-tab";
