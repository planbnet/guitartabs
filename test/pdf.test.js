import { describe, it, expect } from "vitest";
import { buildPdfGroups } from "../js/ui/pdf.js";
import { makeEmptyBlock } from "../js/core/model.js";

const tab = () => makeEmptyBlock(80);
const text = (data) => ({ type: "text", data });
const single = () => text("chord line");
const multi = () => text("line one\nline two");

describe("buildPdfGroups — keep-together pagination units", () => {
  it("keeps a lone tab block as its own group", () => {
    expect(buildPdfGroups([tab()])).toEqual([[0]]);
  });

  it("keeps the single line above a tab with it", () => {
    expect(buildPdfGroups([single(), tab()])).toEqual([[0, 1]]);
  });

  it("keeps a single line below a tab with it", () => {
    expect(buildPdfGroups([tab(), single()])).toEqual([[0, 1]]);
  });

  it("keeps lines both above and below a tab with it", () => {
    expect(buildPdfGroups([single(), tab(), single()])).toEqual([[0, 1, 2]]);
  });

  it("docks a line between two tabs to the tab below it", () => {
    // text is above the second tab, so it groups with the second tab
    expect(buildPdfGroups([tab(), single(), tab()])).toEqual([[0], [1, 2]]);
  });

  it("splits consecutive tab blocks into separate groups", () => {
    expect(buildPdfGroups([tab(), tab()])).toEqual([[0], [1]]);
  });

  it("does not attach a multi-line text block below a tab", () => {
    expect(buildPdfGroups([tab(), multi()])).toEqual([[0], [1]]);
  });

  it("keeps a multi-line text block as its own group", () => {
    expect(buildPdfGroups([multi()])).toEqual([[0]]);
  });

  it("groups a full verse: text + tab + text, then a following tab", () => {
    expect(buildPdfGroups([single(), tab(), single(), tab()])).toEqual([[0, 1], [2, 3]]);
  });
});
