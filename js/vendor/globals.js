// ESM adapter over the classic vendor scripts (loaded as plain <script> tags
// before the module graph). This is the single place the app touches vendor
// globals; tests alias this module.
//
// chords-db.js declares `const CHORDS_DB`, which lives in the global lexical
// environment rather than on globalThis — hence the guarded bare reference.

export const LZString = globalThis.LZString;
export const vexchords = globalThis.vexchords;

let db;
try {
  db = CHORDS_DB;
} catch {
  db = undefined;
}
export { db as CHORDS_DB };
