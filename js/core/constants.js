// Shared constants for the tab data model.

export const STRING_COUNT = 6;

// Open-string notes, high e to low E (display order, top to bottom).
export const TUNINGS = ["e", "B", "G", "D", "A", "E"];

// Line prefixes used in the ASCII text format ("e|", "B|", ...).
export const STRING_LABELS = TUNINGS.map((t) => `${t}|`);

export const DEFAULT_LEN = 80;
export const MIN_LEN = 50;
export const MAX_LEN = 120;

export const STORAGE_KEY = "ascii_tab_editor_v1";
export const MAX_UNDO = 50;
