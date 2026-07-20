import { describe, it, expect } from "vitest";
import { encodeShare, decodeShare } from "../js/core/share.js";
import { makeEmptyBlock } from "../js/core/model.js";
// Aliased to the npm lz-string shim by vitest.config.js
import { LZString } from "../js/vendor/globals.js";
import golden from "./fixtures/golden.json";

describe("share URL encoding", () => {
  it("round-trips a document", () => {
    const block = makeEmptyBlock(80);
    block.data[0][5] = "7";
    const doc = { blocks: [{ type: "text", data: "Hi" }, block], lineLength: 80 };
    const param = encodeShare(doc);
    const decoded = decodeShare(param);
    expect(decoded).toEqual(doc);
  });

  it("decodes the golden pre-refactor share param (backward compatibility)", () => {
    const decoded = decodeShare(golden.shareParam);
    expect(decoded).not.toBeNull();
    expect(decoded.blocks).toEqual(golden.shareData.blocks);
    expect(decoded.lineLength).toBe(golden.shareData.lineLength);
  });

  it("still encodes byte-identically to the pre-refactor code", () => {
    expect(encodeShare({ blocks: golden.shareData.blocks, lineLength: golden.shareData.lineLength }))
      .toBe(golden.shareParam);
  });

  it("returns null for malformed params", () => {
    expect(decodeShare("not-a-valid-param")).toBeNull();
    expect(decodeShare("")).toBeNull();
  });

  it("defaults lineLength when missing", () => {
    const param = LZString.compressToEncodedURIComponent(JSON.stringify({ blocks: [], version: 1 }));
    expect(decodeShare(param).lineLength).toBe(80);
  });
});
