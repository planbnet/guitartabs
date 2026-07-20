// Share-URL encoding: the document compressed into a ?tab=... parameter.
// The format is stable — existing shared links must keep working.

import { LZString } from "../vendor/globals.js";
import { DEFAULT_LEN } from "./constants.js";

export const encodeShare = ({ blocks, lineLength }) =>
  LZString.compressToEncodedURIComponent(
    JSON.stringify({ blocks, lineLength, version: 1 })
  );

export const decodeShare = (param) => {
  try {
    const json = LZString.decompressFromEncodedURIComponent(param);
    if (!json) return null;
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.blocks)) return null;
    return { blocks: data.blocks, lineLength: data.lineLength || DEFAULT_LEN };
  } catch {
    return null;
  }
};
