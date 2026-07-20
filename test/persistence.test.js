import { describe, it, expect, beforeEach } from "vitest";
import { save, load } from "../js/core/persistence.js";
import { state } from "../js/core/store.js";
import { makeEmptyBlock } from "../js/core/model.js";
import golden from "./fixtures/golden.json";

// Minimal localStorage for node
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
};

beforeEach(() => storage.clear());

describe("persistence", () => {
  it("save/load round-trips under the stable key", () => {
    state.blocks = [makeEmptyBlock(80)];
    state.blocks[0].data[3][7] = "5";
    state.lineLength = 80;
    state.cur = { block: 0, stringIdx: 3, col: 8 };
    state.editMode = "insert";

    save();
    expect(storage.has("ascii_tab_editor_v1")).toBe(true);

    const payload = load();
    expect(payload.blocks).toEqual(state.blocks);
    expect(payload.cur).toEqual({ block: 0, stringIdx: 3, col: 8 });
    expect(payload.editMode).toBe("insert");
  });

  it("loads the golden pre-refactor payload", () => {
    storage.set("ascii_tab_editor_v1", JSON.stringify(golden.localStorageModern));
    const payload = load();
    expect(payload.blocks).toEqual(golden.localStorageModern.blocks);
    expect(payload.lineLength).toBe(80);
    expect(payload.editMode).toBe("insert");
  });

  it("migrates the legacy raw-array block format", () => {
    storage.set("ascii_tab_editor_v1", JSON.stringify(golden.localStorageLegacy));
    const payload = load();
    expect(payload.blocks[0].type).toBe("tab");
    expect(payload.blocks[0].data[2][4]).toBe("7");
  });

  it("returns null for corrupt or missing data", () => {
    expect(load()).toBeNull();
    storage.set("ascii_tab_editor_v1", "{corrupt");
    expect(load()).toBeNull();
    storage.set("ascii_tab_editor_v1", JSON.stringify({ nope: true }));
    expect(load()).toBeNull();
  });
});
