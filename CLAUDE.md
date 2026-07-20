# CLAUDE.md

ASCII guitar tab editor — zero-build static PWA (vanilla ES modules, no framework, no bundler). Deployed by pushing to GitHub Pages. UI chrome is [Jelly UI](https://jelly-ui.com) web components (vendored); the monospace tab grid is custom DOM. See README.md for the full architecture and feature docs.

## Commands

```sh
npm run serve      # python3 -m http.server 8000
npm test           # vitest (unit tests over js/core — DOM-free)
```

There is no build or lint step. npm is dev-tooling only; the app runs directly from the repo files.

## Architecture in one paragraph

`js/core/` is DOM-free state + logic (store, editing ops, ASCII parser, share encoding, persistence) and communicates outward only via `js/core/bus.js` events. `js/ui/` renders and subscribes; `js/dropbox/` has a DOM-free `api.js` and a `ui.js`. `js/main.js` bootstraps. Rendering is tiered: `cells-changed {block}` → in-place cell text diff; `cursor/selection-changed` → class toggles; `structure-changed` / `document-replaced` / `linelength-changed` → full `renderAll()`. All cell/button events are delegated from `#editor` — never attach per-cell listeners.

## Hard invariants (do not break)

- localStorage key `ascii_tab_editor_v1` and payload shape `{blocks, lineLength, cur, editMode}`, including the legacy raw-array migration in `core/persistence.js`
- Share URL format `?tab=<LZString.compressToEncodedURIComponent(JSON {blocks, lineLength, version:1})>`
- Data model: `{type:'tab', data: char[6][lineLength]}` | `{type:'text', data: string}`; a single-line text block directly above a tab block is "docked"
- Dropbox OAuth redirect URI = origin + pathname (index.html must stay at repo root); `dbx_*` localStorage keys
- `test/fixtures/golden.json` was generated with the **pre-refactor** code — never regenerate it; it guards backward compatibility of share links and saved documents

## Gotchas

- **Service worker**: `sw.js` (repo root — must stay there for scope) precaches every file. Bump `CACHE_NAME` (`tab-editor-vN`) whenever any cached file changes, and add new files to `urlsToCache`. During local dev, unregister the SW + clear caches (DevTools → Application) or you will test stale files.
- **`js/vendor/globals.js`**: `chords-db.js` declares `const CHORDS_DB` — a global *lexical* binding, NOT a `globalThis` property. The guarded bare reference there is deliberate; `globalThis.CHORDS_DB` is always undefined.
- **Jelly placement rule**: Jelly components only in DOM that never rebuilds on edit (toolbar, dialogs, perform overlay, chord popup). Per-block controls stay plain `<button>`s — dozens of canvas-physics components per render would be too heavy. The tab grid cells are plain spans; keep them that way.
- **Jelly button quirks**: `jelly-button` has no `disabled` property — use `toggleAttribute("disabled", bool)` / `hasAttribute("disabled")`. Composed `click` events bubble from the host.
- **iPad**: the hidden `#kbd` input (`ui/dom.js: focusKeyboard()`) summons the on-screen keyboard; every dialog close must refocus it (handled centrally in `ui/dialogs.js`). Don't call `focusKeyboard()` while a dialog is open (`isAnyDialogOpen()` guard).
- **Undo**: call `saveUndoState()` *before* mutating; ops that change cell data emit `cells-changed` + `dirty`, structural ops emit `structure-changed` + `dirty`. Forgetting `dirty` means the change isn't persisted.
- **Testing**: `vitest.config.js` aliases `js/vendor/globals.js` → `test/vendor-globals.js` (npm lz-string). Keep `js/core/` free of DOM/localStorage access at import time so tests keep running in plain node (localStorage is only touched inside `persistence.js` functions).
