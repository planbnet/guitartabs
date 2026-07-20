import { describe, it, expect } from "vitest";
import {
  clamp,
  makeEmptyBlock,
  isTabBlock,
  isTextBlock,
  isDockedTextBlock,
  getDockedTextBeforeTab,
  getDockedTabForText,
  findPreviousTabBlock,
  hasMeaningfulContent,
  calculateNote,
  getFretNumberInRow,
} from "../js/core/model.js";

const tab = () => makeEmptyBlock(80);
const text = (data) => ({ type: "text", data });

describe("makeEmptyBlock", () => {
  it("creates a 6xN dash grid", () => {
    const block = makeEmptyBlock(50);
    expect(block.type).toBe("tab");
    expect(block.data).toHaveLength(6);
    expect(block.data[0]).toHaveLength(50);
    expect(block.data.every((row) => row.every((c) => c === "-"))).toBe(true);
  });
});

describe("isDockedTextBlock", () => {
  it("is true for a single-line text block directly above a tab", () => {
    expect(isDockedTextBlock([text("Am F"), tab()], 0)).toBe(true);
  });
  it("is false for multi-line text", () => {
    expect(isDockedTextBlock([text("a\nb"), tab()], 0)).toBe(false);
  });
  it("is false without a following tab", () => {
    expect(isDockedTextBlock([text("Am"), text("x")], 0)).toBe(false);
    expect(isDockedTextBlock([text("Am")], 0)).toBe(false);
  });
  it("is false out of range and for tab blocks", () => {
    expect(isDockedTextBlock([tab()], -1)).toBe(false);
    expect(isDockedTextBlock([tab()], 5)).toBe(false);
    expect(isDockedTextBlock([tab(), tab()], 0)).toBe(false);
  });
});

describe("docking navigation helpers", () => {
  const blocks = [text("chords"), tab(), text("outro")];
  it("getDockedTextBeforeTab", () => {
    expect(getDockedTextBeforeTab(blocks, 1)).toBe(0);
    expect(getDockedTextBeforeTab(blocks, 0)).toBe(-1);
  });
  it("getDockedTabForText", () => {
    expect(getDockedTabForText(blocks, 0)).toBe(1);
    expect(getDockedTabForText(blocks, 2)).toBe(-1);
  });
  it("findPreviousTabBlock", () => {
    expect(findPreviousTabBlock(blocks, 2)).toBe(1);
    expect(findPreviousTabBlock(blocks, 1)).toBe(-1);
  });
});

describe("hasMeaningfulContent", () => {
  it("empty grid and bars only → false", () => {
    const b = tab();
    b.data[0][3] = "|";
    expect(hasMeaningfulContent([b, text("  ")])).toBe(false);
  });
  it("a fret number → true", () => {
    const b = tab();
    b.data[2][3] = "7";
    expect(hasMeaningfulContent([b])).toBe(true);
  });
  it("text content → true", () => {
    expect(hasMeaningfulContent([text("Intro")])).toBe(true);
  });
});

describe("calculateNote", () => {
  it("open strings", () => {
    expect(calculateNote(0, 0)).toBe("E"); // high e
    expect(calculateNote(5, 0)).toBe("E"); // low E
    expect(calculateNote(1, 0)).toBe("B");
  });
  it("fretted notes wrap around octaves", () => {
    expect(calculateNote(5, 5)).toBe("A");
    expect(calculateNote(0, 13)).toBe("F");
  });
  it("invalid input", () => {
    expect(calculateNote(-1, 0)).toBeNull();
    expect(calculateNote(0, -2)).toBeNull();
  });
});

describe("getFretNumberInRow", () => {
  const row = (s) => s.split("");
  it("single digit", () => {
    expect(getFretNumberInRow(row("--7-"), 2)).toBe(7);
  });
  it("two digits read together from either cell", () => {
    expect(getFretNumberInRow(row("-12-"), 1)).toBe(12);
    expect(getFretNumberInRow(row("-12-"), 2)).toBe(12);
  });
  it("non-digit cells return null", () => {
    expect(getFretNumberInRow(row("--h-"), 2)).toBeNull();
    expect(getFretNumberInRow(row("----"), 1)).toBeNull();
  });
  it("runs longer than 2 digits fall back to single digits", () => {
    expect(getFretNumberInRow(row("-123-"), 2)).toBe(2);
  });
  it("values above 36 fall back to single digits", () => {
    expect(getFretNumberInRow(row("-99-"), 1)).toBe(9);
  });

  it("clamp", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  it("type guards", () => {
    expect(isTabBlock(tab())).toBe(true);
    expect(isTabBlock(text("x"))).toBe(false);
    expect(isTextBlock(text("x"))).toBe(true);
    expect(isTextBlock(null)).toBe(false);
  });
});
