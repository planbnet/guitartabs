import { describe, it, expect, beforeEach, vi } from "vitest";
import { on } from "../js/core/bus.js";
import { makeEmptyBlock } from "../js/core/model.js";
import {
  state,
  setCursor,
  setSelection,
  clearSelection,
  getSelectionBounds,
  setClipboardData,
  getClipboardData,
  hasClipboardData,
  setEditMode,
  cycleEditMode,
  saveUndoState,
  undo,
  replaceDocument,
  startKeyboardSelection,
  updateKeyboardSelection,
} from "../js/core/store.js";

const resetState = () => {
  state.blocks = [makeEmptyBlock(80), makeEmptyBlock(80)];
  state.lineLength = 80;
  state.cur = { block: 0, stringIdx: 0, col: 0 };
  state.editMode = "replace";
  state.selection = null;
  state.clipboard = null;
  state.undoStack = [];
  state.isUndoing = false;
  state.keyboardSelectionAnchor = null;
};

beforeEach(resetState);

describe("cursor", () => {
  it("clamps to valid ranges", () => {
    setCursor(99, 42, 500);
    expect(state.cur).toEqual({ block: 1, stringIdx: 5, col: 79 });
    setCursor(-3, -1, -1);
    expect(state.cur).toEqual({ block: 0, stringIdx: 0, col: 0 });
  });

  it("emits cursor-changed", () => {
    const spy = vi.fn();
    on("cursor-changed", spy);
    setCursor(0, 1, 2);
    expect(spy).toHaveBeenCalled();
  });
});

describe("selection", () => {
  it("normalizes reversed rectangles", () => {
    setSelection({ block: 0, startString: 4, endString: 1, startCol: 30, endCol: 10 });
    expect(getSelectionBounds()).toEqual({ block: 0, startString: 1, endString: 4, startCol: 10, endCol: 30 });
  });

  it("clamps columns to lineLength", () => {
    setSelection({ block: 0, startString: 0, endString: 0, startCol: 0, endCol: 500 });
    expect(getSelectionBounds().endCol).toBe(79);
  });

  it("rejects out-of-range blocks", () => {
    setSelection({ block: 9, startString: 0, endString: 0, startCol: 0, endCol: 1 });
    expect(getSelectionBounds()).toBeNull();
  });

  it("clearSelection resets the keyboard anchor", () => {
    startKeyboardSelection();
    expect(state.keyboardSelectionAnchor).not.toBeNull();
    clearSelection();
    expect(state.keyboardSelectionAnchor).toBeNull();
  });

  it("keyboard selection extends from the anchor", () => {
    setCursor(0, 2, 5);
    startKeyboardSelection();
    setCursor(0, 4, 8);
    updateKeyboardSelection();
    expect(getSelectionBounds()).toEqual({ block: 0, startString: 2, endString: 4, startCol: 5, endCol: 8 });
  });
});

describe("clipboard", () => {
  it("deep-clones data both ways", () => {
    const payload = { width: 2, height: 1, data: [["1", "2"]] };
    setClipboardData(payload);
    payload.data[0][0] = "X";
    expect(getClipboardData().data[0][0]).toBe("1");
    expect(hasClipboardData()).toBe(true);
    setClipboardData(null);
    expect(hasClipboardData()).toBe(false);
  });
});

describe("edit mode", () => {
  it("cycles replace → shift → insert → replace", () => {
    cycleEditMode();
    expect(state.editMode).toBe("shift");
    cycleEditMode();
    expect(state.editMode).toBe("insert");
    cycleEditMode();
    expect(state.editMode).toBe("replace");
  });

  it("ignores invalid modes", () => {
    setEditMode("bogus");
    expect(state.editMode).toBe("replace");
  });

  it("emits editmode-changed", () => {
    const spy = vi.fn();
    on("editmode-changed", spy);
    setEditMode("insert");
    expect(spy).toHaveBeenCalled();
  });
});

describe("undo", () => {
  it("restores blocks, cursor, mode and length", () => {
    saveUndoState();
    state.blocks[0].data[0][0] = "7";
    state.editMode = "insert";
    state.lineLength = 100;
    setCursor(1, 3, 9);

    undo();

    expect(state.blocks[0].data[0][0]).toBe("-");
    expect(state.editMode).toBe("replace");
    expect(state.lineLength).toBe(80);
    expect(state.cur).toEqual({ block: 0, stringIdx: 0, col: 0 });
  });

  it("caps the stack at 50 snapshots", () => {
    for (let i = 0; i < 60; i++) saveUndoState();
    expect(state.undoStack.length).toBe(50);
  });

  it("does nothing on an empty stack", () => {
    expect(() => undo()).not.toThrow();
  });

  it("skips snapshots while undoing", () => {
    state.isUndoing = true;
    saveUndoState();
    expect(state.undoStack.length).toBe(0);
  });
});

describe("replaceDocument", () => {
  it("swaps content and resets the cursor", () => {
    const blocks = [{ type: "text", data: "hello" }];
    replaceDocument({ blocks, lineLength: 100 });
    expect(state.blocks).toBe(blocks);
    expect(state.lineLength).toBe(100);
    expect(state.cur).toEqual({ block: 0, stringIdx: 0, col: 0 });
  });

  it("guarantees at least one block", () => {
    replaceDocument({ blocks: [] });
    expect(state.blocks.length).toBe(1);
    expect(state.blocks[0].type).toBe("tab");
  });

  it("keeps provided cursor and edit mode (localStorage load path)", () => {
    replaceDocument({
      blocks: [makeEmptyBlock(80)],
      lineLength: 80,
      cur: { block: 0, stringIdx: 3, col: 7 },
      editMode: "shift",
    });
    expect(state.cur).toEqual({ block: 0, stringIdx: 3, col: 7 });
    expect(state.editMode).toBe("shift");
  });
});
