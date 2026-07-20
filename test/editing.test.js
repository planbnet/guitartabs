import { describe, it, expect, beforeEach } from "vitest";
import { makeEmptyBlock } from "../js/core/model.js";
import { state, setSelection, setClipboardData } from "../js/core/store.js";
import {
  handlePrintable,
  insertCharacterAtCursor,
  smartInsertCharacter,
  smartDeleteCharacter,
  insertBarAtCursor,
  deleteSelectionOrChar,
  clearSelectionOrChar,
  copySelectionFromBlock,
  pasteClipboardIntoBlock,
  applyLength,
  shiftBlockForInsert,
  newTabBlock,
  deleteBlock,
  moveBlock,
} from "../js/core/editing.js";

const LEN = 80;

const resetState = ({ editMode = "replace", blocks = null } = {}) => {
  state.blocks = blocks || [makeEmptyBlock(LEN)];
  state.lineLength = LEN;
  state.cur = { block: 0, stringIdx: 0, col: 0 };
  state.editMode = editMode;
  state.selection = null;
  state.clipboard = null;
  state.undoStack = [];
  state.isUndoing = false;
  state.keyboardSelectionAnchor = null;
};

const row = (blockIdx, stringIdx) => state.blocks[blockIdx].data[stringIdx].join("");

beforeEach(() => resetState());

describe("handlePrintable — replace mode", () => {
  it("overwrites and advances", () => {
    handlePrintable("5");
    handlePrintable("7");
    expect(row(0, 0).startsWith("57")).toBe(true);
    expect(state.cur.col).toBe(2);
  });

  it("converts spaces to dashes", () => {
    handlePrintable(" ");
    expect(state.blocks[0].data[0][0]).toBe("-");
  });

  it("'|' draws a full vertical bar", () => {
    handlePrintable("|");
    for (let s = 0; s < 6; s++) expect(state.blocks[0].data[s][0]).toBe("|");
  });

  it("overwriting a bar clears the whole column first", () => {
    handlePrintable("|");
    state.cur = { block: 0, stringIdx: 2, col: 0 };
    handlePrintable("3");
    expect(state.blocks[0].data[2][0]).toBe("3");
    expect(state.blocks[0].data[0][0]).toBe("-");
    expect(state.blocks[0].data[5][0]).toBe("-");
  });
});

describe("handlePrintable — shift mode", () => {
  it("shifts the entire column right", () => {
    resetState({ editMode: "shift" });
    state.blocks[0].data[3][0] = "9";
    handlePrintable("5");
    expect(state.blocks[0].data[0][0]).toBe("5");
    expect(state.blocks[0].data[3][1]).toBe("9"); // pushed right
  });
});

describe("insertCharacterAtCursor — overflow cascade", () => {
  it("cascades the last character into the next tab block", () => {
    resetState({ editMode: "shift", blocks: [makeEmptyBlock(LEN), makeEmptyBlock(LEN)] });
    state.blocks[0].data[0][LEN - 1] = "7";
    insertCharacterAtCursor("1");
    expect(state.blocks[1].data[0][0]).toBe("7");
    expect(state.blocks[0].data[0][0]).toBe("1");
  });

  it("creates a new block when there is no next tab block", () => {
    resetState({ editMode: "shift" });
    state.blocks[0].data[2][LEN - 1] = "8";
    insertCharacterAtCursor("1");
    expect(state.blocks).toHaveLength(2);
    expect(state.blocks[1].data[2][0]).toBe("8");
  });

  it("discards trailing dashes and bars instead of cascading them", () => {
    resetState({ editMode: "shift" });
    state.blocks[0].data[0][LEN - 1] = "|";
    insertCharacterAtCursor("1");
    expect(state.blocks).toHaveLength(1);
  });
});

describe("smartInsertCharacter — insert mode", () => {
  it("shifts only to the next aligned bar", () => {
    resetState({ editMode: "insert" });
    // Full bar at col 10, content at col 5 on string 0, marker beyond the bar
    for (let s = 0; s < 6; s++) state.blocks[0].data[s][10] = "|";
    state.blocks[0].data[0][5] = "3";
    state.blocks[0].data[0][12] = "9";
    state.cur = { block: 0, stringIdx: 0, col: 0 };

    smartInsertCharacter("7");

    expect(state.blocks[0].data[0][0]).toBe("7");
    expect(state.blocks[0].data[0][6]).toBe("3"); // shifted within the section
    expect(state.blocks[0].data[0][10]).toBe("|"); // bar unmoved
    expect(state.blocks[0].data[0][12]).toBe("9"); // content after bar unmoved
  });

  it("falls back to whole-line shift when the section is full", () => {
    resetState({ editMode: "insert" });
    for (let s = 0; s < 6; s++) state.blocks[0].data[s][3] = "|";
    // Fill section before the bar completely
    state.blocks[0].data[0][0] = "1";
    state.blocks[0].data[0][1] = "2";
    state.blocks[0].data[0][2] = "3";
    state.cur = { block: 0, stringIdx: 0, col: 0 };

    smartInsertCharacter("7");

    // Whole line shifted: bar pushed right
    expect(state.blocks[0].data[0][0]).toBe("7");
    expect(state.blocks[0].data[0][4]).toBe("|");
  });
});

describe("smartDeleteCharacter — insert mode", () => {
  it("forward delete pulls content left within the section", () => {
    resetState({ editMode: "insert" });
    for (let s = 0; s < 6; s++) state.blocks[0].data[s][10] = "|";
    state.blocks[0].data[0][0] = "1";
    state.blocks[0].data[0][1] = "2";
    state.blocks[0].data[0][12] = "9";
    state.cur = { block: 0, stringIdx: 0, col: 0 };

    smartDeleteCharacter("forward");

    expect(state.blocks[0].data[0][0]).toBe("2");
    expect(state.blocks[0].data[0][9]).toBe("-");
    expect(state.blocks[0].data[0][10]).toBe("|"); // bar unmoved
    expect(state.blocks[0].data[0][12]).toBe("9");
  });

  it("backward delete in the first section shifts to the next bar", () => {
    resetState({ editMode: "insert" });
    for (let s = 0; s < 6; s++) state.blocks[0].data[s][5] = "|";
    state.blocks[0].data[0][1] = "3";
    state.blocks[0].data[0][2] = "4";
    state.cur = { block: 0, stringIdx: 0, col: 1 };

    smartDeleteCharacter("backward");

    expect(state.blocks[0].data[0][1]).toBe("4");
    expect(state.blocks[0].data[0][5]).toBe("|");
  });
});

describe("selection operations", () => {
  it("copy + paste round-trips a rectangle", () => {
    state.blocks[0].data[1][2] = "5";
    state.blocks[0].data[2][3] = "7";
    setSelection({ block: 0, startString: 1, endString: 2, startCol: 2, endCol: 3 });
    copySelectionFromBlock(0);
    expect(state.clipboard).toEqual({ width: 2, height: 2, data: [["5", "-"], ["-", "7"]] });

    state.cur = { block: 0, stringIdx: 4, col: 10 };
    pasteClipboardIntoBlock(0);
    expect(state.blocks[0].data[4][10]).toBe("5");
    expect(state.blocks[0].data[5][11]).toBe("7");
    expect(state.cur.col).toBe(11);
  });

  it("full-height paste shifts the whole block", () => {
    const data = Array.from({ length: 6 }, () => ["9"]);
    setClipboardData({ width: 1, height: 6, data });
    state.blocks[0].data[0][0] = "3";
    state.cur = { block: 0, stringIdx: 0, col: 0 };
    pasteClipboardIntoBlock(0);
    expect(state.blocks[0].data[0][0]).toBe("9");
    expect(state.blocks[0].data[0][1]).toBe("3"); // shifted
  });

  it("deleteSelectionOrChar removes the selected width and pulls left", () => {
    state.blocks[0].data[0][5] = "8";
    setSelection({ block: 0, startString: 0, endString: 0, startCol: 0, endCol: 2 });
    deleteSelectionOrChar(0);
    expect(state.blocks[0].data[0][2]).toBe("8"); // pulled left by 3
    expect(state.selection).toBeNull();
  });

  it("clearSelectionOrChar blanks cells in place", () => {
    state.blocks[0].data[0][1] = "8";
    setSelection({ block: 0, startString: 0, endString: 0, startCol: 0, endCol: 2 });
    clearSelectionOrChar(0);
    expect(row(0, 0).slice(0, 4)).toBe("----");
  });
});

describe("block commands", () => {
  it("insertBarAtCursor draws a full column", () => {
    state.cur.col = 4;
    insertBarAtCursor();
    for (let s = 0; s < 6; s++) expect(state.blocks[0].data[s][4]).toBe("|");
  });

  it("newTabBlock inserts after the cursor block and moves into it", () => {
    newTabBlock();
    expect(state.blocks).toHaveLength(2);
    expect(state.cur.block).toBe(1);
  });

  it("deleteBlock adjusts the cursor and never deletes the last block", () => {
    newTabBlock();
    deleteBlock(1);
    expect(state.blocks).toHaveLength(1);
    expect(state.cur.block).toBe(0);
    deleteBlock(0);
    expect(state.blocks).toHaveLength(1);
  });

  it("moveBlock swaps neighbours and follows the cursor", () => {
    state.blocks.push({ type: "text", data: "hello" });
    state.cur.block = 1;
    moveBlock(1, -1);
    expect(state.blocks[0].type).toBe("text");
    expect(state.cur.block).toBe(0);
  });
});

describe("applyLength", () => {
  it("resizes tab blocks preserving content, clamps to 50..120", () => {
    state.blocks[0].data[0][45] = "7";
    applyLength(50);
    expect(state.lineLength).toBe(50);
    expect(state.blocks[0].data[0]).toHaveLength(50);
    expect(state.blocks[0].data[0][45]).toBe("7");

    applyLength(500);
    expect(state.lineLength).toBe(120);
    expect(state.blocks[0].data[0][45]).toBe("7");
  });

  it("leaves text blocks alone", () => {
    state.blocks.push({ type: "text", data: "keep" });
    applyLength(60);
    expect(state.blocks[1].data).toBe("keep");
  });
});

describe("shiftBlockForInsert", () => {
  it("shifts selected rows right by width", () => {
    state.blocks[0].data[2][0] = "5";
    shiftBlockForInsert(state.blocks[0], 0, 3, [2]);
    expect(state.blocks[0].data[2][3]).toBe("5");
    expect(state.blocks[0].data[2].slice(0, 3).join("")).toBe("---");
  });
});
