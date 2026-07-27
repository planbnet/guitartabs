// Pure materialization of a listening-session event list into tab blocks.

import { makeEmptyBlock, isTabBlock } from "./model.js";

const clone = (value) => structuredClone(value);

const ensureTabCapacity = (blocks, tabIndices, requiredCells, lineLength) => {
  while (tabIndices.length * lineLength < requiredCells) {
    const insertAt = tabIndices[tabIndices.length - 1] + 1;
    blocks.splice(insertAt, 0, makeEmptyBlock(lineLength));
    tabIndices.push(insertAt);
  }
};

export const phraseWidth = (events) =>
  events.reduce((sum, event) => {
    const candidate = event.candidates[event.selectedCandidate];
    return sum + (candidate?.width || 1) + 1;
  }, 0);

export const materializeListeningPhrase = ({
  baselineBlocks,
  startBlock,
  startCol,
  startString = 0,
  lineLength,
  editMode,
  events,
}) => {
  const blocks = clone(baselineBlocks);
  const tabIndices = [];
  for (let i = startBlock; i < blocks.length; i++) {
    if (!isTabBlock(blocks[i])) break;
    tabIndices.push(i);
  }
  if (!tabIndices.length || tabIndices[0] !== startBlock) {
    return { blocks, cur: { block: startBlock, stringIdx: startString, col: startCol } };
  }

  const totalWidth = phraseWidth(events);
  const baselineCells = tabIndices.length * lineLength;
  const requiredCells = editMode === "replace"
    ? Math.max(baselineCells, startCol + totalWidth)
    : baselineCells + totalWidth;
  ensureTabCapacity(blocks, tabIndices, requiredCells, lineLength);

  const rows = Array.from({ length: 6 }, (_, stringIdx) =>
    tabIndices.flatMap((blockIdx) => blocks[blockIdx].data[stringIdx])
  );
  const absoluteStart = startCol;

  if (editMode !== "replace" && totalWidth > 0) {
    rows.forEach((row) => row.splice(absoluteStart, 0, ...new Array(totalWidth).fill("-")));
  }
  rows.forEach((row) => {
    while (row.length < tabIndices.length * lineLength) row.push("-");
  });

  let offset = 0;
  for (const event of events) {
    const candidate = event.candidates[event.selectedCandidate];
    if (!candidate) continue;
    const width = candidate.width || 1;
    for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
      const value = candidate.rows[stringIdx] || "";
      for (let i = 0; i < width; i++) rows[stringIdx][absoluteStart + offset + i] = "-";
      for (let i = 0; i < value.length; i++) rows[stringIdx][absoluteStart + offset + i] = value[i];
    }
    offset += width + 1;
  }

  tabIndices.forEach((blockIdx, timelineIdx) => {
    for (let stringIdx = 0; stringIdx < 6; stringIdx++) {
      const start = timelineIdx * lineLength;
      blocks[blockIdx].data[stringIdx] = rows[stringIdx].slice(start, start + lineLength);
    }
  });

  const lastAbsolute = Math.max(absoluteStart, absoluteStart + totalWidth - 1);
  const timelineBlock = Math.min(Math.floor(lastAbsolute / lineLength), tabIndices.length - 1);
  return {
    blocks,
    cur: {
      block: tabIndices[timelineBlock],
      stringIdx: startString,
      col: lastAbsolute % lineLength,
    },
  };
};

export const rerankUnpinnedEvents = (events, rerank) => {
  let anchorFret = null;
  let previousString = null;
  return events.map((event, index) => {
    let next = event;
    if (!event.manuallyPinned) {
      const candidates = rerank(event, { anchorFret, previousString, index });
      next = { ...event, candidates, selectedCandidate: 0 };
    }
    const selected = next.candidates[next.selectedCandidate];
    if (selected) {
      anchorFret = selected.positionFret;
      previousString = selected.stringIdx ?? previousString;
    }
    return next;
  });
};
