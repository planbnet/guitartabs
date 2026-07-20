// Test substitute for js/vendor/globals.js (aliased in vitest.config.js).
// Uses the npm lz-string package — same library, same URL format.

import LZString from "lz-string";

export { LZString };
export const vexchords = undefined;
export const CHORDS_DB = undefined;
