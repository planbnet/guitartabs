import { describe, it, expect } from "vitest";
import {
  isTabSequence,
  formatContentForExport,
  parseImportedContent,
  extractTitle,
  sanitizeFilename,
} from "../js/core/serialize.js";
import { makeEmptyBlock } from "../js/core/model.js";
import golden from "./fixtures/golden.json";

const LEN = 80;

const tabWith = (cells) => {
  const b = makeEmptyBlock(LEN);
  cells.forEach(([s, c, ch]) => { b.data[s][c] = ch; });
  return b;
};

describe("isTabSequence", () => {
  it("accepts the canonical 6-line prefix order", () => {
    const lines = ["e|--", "B|--", "G|--", "D|--", "A|--", "E|--"];
    expect(isTabSequence(lines)).toBe(true);
  });
  it("rejects wrong order or short input", () => {
    expect(isTabSequence(["E|-", "B|-", "G|-", "D|-", "A|-", "e|-"])).toBe(false);
    expect(isTabSequence(["e|-"])).toBe(false);
  });
});

describe("formatContentForExport", () => {
  it("renders tab blocks with string labels", () => {
    const content = formatContentForExport([tabWith([[0, 0, "3"]])]);
    const lines = content.split("\n");
    expect(lines[0].startsWith("e|3")).toBe(true);
    expect(lines[5].startsWith("E|")).toBe(true);
  });

  it("separates blocks with blank lines, except docked text", () => {
    const blocks = [
      { type: "text", data: "Title" },
      { type: "text", data: "  Am  F" }, // docked (single line before tab)
      tabWith([]),
    ];
    const content = formatContentForExport(blocks);
    const lines = content.split("\n");
    expect(lines[0]).toBe("Title");
    expect(lines[1]).toBe(""); // blank after non-docked text
    expect(lines[2]).toBe("  Am  F");
    expect(lines[3].startsWith("e|")).toBe(true); // docked: no blank line
  });
});

describe("parseImportedContent", () => {
  it("round-trips export → parse", () => {
    const blocks = [
      { type: "text", data: "My Song\n\nsome intro text" },
      { type: "text", data: "  Am      F" },
      tabWith([[0, 5, "3"], [5, 17, "3"], [0, 22, "1"], [0, 23, "2"]]),
    ];
    const content = formatContentForExport(blocks);
    const parsed = parseImportedContent(content, LEN);
    expect(parsed.lineLength).toBe(LEN);
    expect(parsed.blocks).toHaveLength(3);
    expect(parsed.blocks[0]).toEqual({ type: "text", data: "My Song\n\nsome intro text" });
    expect(parsed.blocks[1]).toEqual({ type: "text", data: "  Am      F" });
    expect(parsed.blocks[2].data[0][5]).toBe("3");
    expect(parsed.blocks[2].data[0].slice(22, 24).join("")).toBe("12");
  });

  it("round-trips the golden fixture", () => {
    const content = formatContentForExport(golden.blocks);
    const parsed = parseImportedContent(content, golden.lineLength);
    expect(parsed.blocks).toEqual(golden.blocks);
    expect(parsed.lineLength).toBe(golden.lineLength);
  });

  it("handles CRLF line endings", () => {
    const content = "Title\r\n\r\ne|--3--\r\nB|-----\r\nG|-----\r\nD|-----\r\nA|-----\r\nE|-----\r\n";
    const parsed = parseImportedContent(content, LEN);
    expect(parsed.blocks[0]).toEqual({ type: "text", data: "Title" });
    expect(parsed.blocks[1].type).toBe("tab");
    expect(parsed.blocks[1].data[0][2]).toBe("3");
  });

  it("grows lineLength to the widest tab line, clamped to 120", () => {
    const wide = "-".repeat(200);
    const content = `e|${wide}\nB|${wide}\nG|${wide}\nD|${wide}\nA|${wide}\nE|${wide}\n`;
    const parsed = parseImportedContent(content, 50);
    expect(parsed.lineLength).toBe(120);
    expect(parsed.blocks[0].data[0]).toHaveLength(120);
  });

  it("pads short tab lines with dashes", () => {
    const content = "e|-3\nB|-\nG|\nD|-\nA|-\nE|-\n";
    const parsed = parseImportedContent(content, 50);
    expect(parsed.lineLength).toBe(50);
    expect(parsed.blocks[0].data[0]).toHaveLength(50);
    expect(parsed.blocks[0].data[0][1]).toBe("3");
    expect(parsed.blocks[0].data[2].every((c) => c === "-")).toBe(true);
  });

  it("docks only standalone lines directly before a tab", () => {
    const content =
      "verse line one\nverse line two\n\nchord line\ne|--\nB|--\nG|--\nD|--\nA|--\nE|--\n";
    const parsed = parseImportedContent(content, LEN);
    expect(parsed.blocks[0]).toEqual({ type: "text", data: "verse line one\nverse line two" });
    expect(parsed.blocks[1]).toEqual({ type: "text", data: "chord line" });
    expect(parsed.blocks[2].type).toBe("tab");
  });

  it("keeps attached multi-line text as one block (no docking)", () => {
    const content = "line one\nline two\ne|--\nB|--\nG|--\nD|--\nA|--\nE|--\n";
    const parsed = parseImportedContent(content, LEN);
    expect(parsed.blocks[0]).toEqual({ type: "text", data: "line one\nline two" });
    expect(parsed.blocks[1].type).toBe("tab");
  });

  it("returns an empty tab block for empty input", () => {
    const parsed = parseImportedContent("", LEN);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].type).toBe("tab");
  });
});

describe("extractTitle", () => {
  it("first line followed by a blank line", () => {
    expect(extractTitle("My Song\n\ne|--")).toBe("My Song");
  });
  it("line directly above a tab", () => {
    expect(extractTitle("Riff\ne|--\nB|--\nG|--\nD|--\nA|--\nE|--")).toBe("Riff");
  });
  it("fallback: any first non-empty line", () => {
    expect(extractTitle("Only text\nmore")).toBe("Only text");
  });
  it("null for empty content", () => {
    expect(extractTitle("")).toBeNull();
    expect(extractTitle(null)).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it("removes invalid characters and collapses spaces", () => {
    expect(sanitizeFilename('My <Song>: "Best"  Version?')).toBe("My Song Best Version");
  });
  it("falls back for empty results", () => {
    expect(sanitizeFilename("???")).toBe("guitar-tab");
  });
  it("caps length at 200", () => {
    expect(sanitizeFilename("x".repeat(300))).toHaveLength(200);
  });
});
