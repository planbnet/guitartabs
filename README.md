# ASCII Guitar Tab Editor

**🎸 [Try it live on GitHub Pages](https://planbnet.github.io/guitartabs/)**

A lightweight, offline-capable web application for creating and editing ASCII-style guitar tablature. Works seamlessly on desktop browsers and iPad devices with full keyboard and touch support. The UI is built on [Jelly UI](https://jelly-ui.com) — soft, tactile web components with a playful wobble.

## What It Does

This editor lets you create guitar tabs using ASCII characters, the standard format used across the internet for sharing guitar music. You can:

- **Create tab blocks**: Add tablature sections with 6 strings (standard guitar tuning: E-A-D-G-B-e)
- **Add text blocks**: Insert lyrics, chord names, or annotations between tab sections
- **Edit with three modes**: Choose between Replace, Shift, or Insert modes depending on your workflow
- **Visual chord diagrams**: Type chord names (e.g., "C", "Am7", "D#m") and click them to see fingering diagrams
- **Navigate efficiently**: Use arrow keys, keyboard shortcuts, or mouse/touch to move around
- **Undo mistakes**: Full undo history keeps your work safe
- **Work offline**: Install as a Progressive Web App (PWA) and use without internet
- **Light & dark**: Follows your OS color scheme automatically
- **Play notes into the tab**: Analyze a microphone or line input entirely in the browser

## Listen: Play Guitar Into the Tab

Place the cursor in a tab block and click **Listen**. Choose the browser audio
input and one of two local analysis modes:

- **Lead notes** detects one note at a time with low latency and inserts a
  playable string/fret choice.
- **Chords** uses a locally bundled Spotify Basic Pitch model, then matches the
  detected pitches to common shapes in the existing chord database. Chord
  analysis uses rolling windows, so results appear a few seconds after playing.

The session starts exactly at the current cursor. Use Left/Right to review
detected events, Up/Down to choose another fretboard position, and Space to
pause or resume. A selected position anchors later choices so phrases remain in
the same area of the neck. **Done** keeps the phrase as one undoable edit;
**Cancel** restores the pre-listen tab.

Microphone and line-input samples are processed in memory with Web Audio,
TensorFlow.js, and the bundled model. Audio is never uploaded. Browser
permission and HTTPS (or localhost during development) are required. The first
version targets clean solo guitar in standard EADGBE tuning; mixed songs,
alternate tunings, rhythm transcription, and playing techniques are not
inferred.

## Import & Export

The **Text** button opens a dialog that shows your entire tab as plain text. This is your hub for importing and exporting tabs:

### Exporting
1. Click the **Text** button in the toolbar
2. Your complete tab appears in the text area
3. Click **Export** to download as a `.txt` file
   - If the first line is text followed by an empty line, it will be used as the filename
   - Otherwise, defaults to `guitar-tab.txt`
4. Click **PDF** to open your browser's print dialog (choose "Save as PDF")
   - The font is scaled so a full tab line fits the page width
   - Tab blocks never split across a page break, and stay with their docked chord/lyric line above (and a single annotation line below)

### Importing
1. Click the **Text** button in the toolbar
2. Choose an import method:
   - **Import File**: Browse and select a `.txt` tab file from your device
   - **Import Clipboard**: Paste tab text you've already copied
   - **Manual entry**: Type or paste directly into the text area, then click **Update**

The parser detects tab blocks (6 consecutive lines starting with string labels like `e|`, `B|`, etc.) and text blocks. Empty lines separate blocks. A single text line directly above a tab block becomes a "docked" chord/lyric line attached to that tab.

## Share via URL

The **Share** button (in the Text dialog) generates a shareable URL that includes your entire tab:

1. Click the **Text** button, then click **Share**
2. A URL is automatically copied to your clipboard
3. Share this URL with anyone — they can open it to instantly load your tab

Tab data is compressed with [LZ-String](https://pieroxy.net/blog/pages/lz-string/index.html) into a `?tab=...` URL parameter. URLs are validated to stay under 2,000 characters; if your tab is too large, use Export instead. The URL format is stable — old shared links keep working.

## Dropbox Integration

Connect to your Dropbox account to open and save tab files directly from the cloud — no server required.

### Setup
1. The app uses Dropbox OAuth2 with PKCE (no secret needed, safe for public repos)
2. Click **Settings** → **Connect to Dropbox** to authorize
3. Choose a folder in your Dropbox to use as your tab library

### Usage
- **Open**: Click the **Open** button in the toolbar to browse (with clickable breadcrumbs) and load `.txt` files
- **Save**: Click the **Save** button to write back to Dropbox — previously opened files are auto-overwritten, new files prompt for a filename
- Your selected folder and current file are remembered in localStorage across sessions
- Tokens auto-refresh so you stay connected

## Perform Mode

A fullscreen auto-scrolling view for playing along to your tabs. Click the amber **Perform** button; the tab is rendered read-only at the largest monospace font that fits the screen width.

- Scrolling speed is measured in **seconds per line**, adjustable in 0.5s increments
- Pressing Play starts a **countdown** (progress bar at the top) so you can read the first screen; scrolling manually skips it
- Controls: ⏮ reset · ▶/⏸ play/pause · −/+ speed · ⛶ fullscreen · ✕ exit
- Keyboard: Space play/pause, +/− speed, F fullscreen, arrows scroll, Escape exit

## Chord Shape Diagrams

Chord names typed in a docked text line (like `C`, `Gmaj7`, or `F#m`) become clickable. The popup shows a fret diagram ([vexchords](https://github.com/0xfe/vexchords)) with alternative fingerings from [chords-db](https://github.com/tombatossals/chords-db), and an **Insert** button that writes the fingering into the tab below.

---

## Development

The app is **zero-build**: plain ES modules served as static files — push to GitHub Pages to deploy. npm is used for dev tooling only.

```sh
npm install        # dev dependencies (vitest)
npm run serve      # python3 -m http.server 8000
npm test           # unit tests (vitest)
```

> **Service worker note:** all app files are precached by `sw.js`. Whenever any cached file changes, bump `CACHE_NAME` in `sw.js` (`tab-editor-vN`) so clients pick up the new version. During local development you may need to unregister the service worker (DevTools → Application) to see changes.

### Architecture

Vanilla ES modules with a central mutable store and a tiny event bus. `core/` is DOM-free (unit-testable); `ui/` renders and subscribes to bus events. UI chrome uses [Jelly UI](https://jelly-ui.com) web components (vendored bundle, no build step); the monospace tab grid is custom DOM kept deliberately lightweight.

```
guitartabs/
├── index.html            # Markup: jelly-theme wrapper, toolbar, dialogs
├── styles.css            # Custom styling (grid, blocks, popups) on Jelly's palette
├── sw.js                 # Service worker (precaches everything for offline)
├── manifest.json         # PWA manifest
├── package.json          # Dev tooling only (vitest)
└── js/
    ├── main.js           # Bootstrap: init modules, load document, register SW
    ├── core/             # DOM-free logic (unit-tested)
    │   ├── constants.js  #   Tunings, lengths, storage key
    │   ├── bus.js        #   Event bus (cells-changed, structure-changed, dirty, …)
    │   ├── model.js      #   Pure data-model helpers (docking, notes, frets)
    │   ├── store.js      #   State + mutators (cursor, selection, undo, edit mode)
    │   ├── editing.js    #   Tab operations (insert/delete/shift/paste/blocks)
    │   ├── serialize.js  #   ASCII format parser/formatter, titles, filenames
    │   ├── share.js      #   Share-URL encode/decode (stable format)
    │   └── persistence.js#   localStorage save/load (stable key + legacy migration)
    ├── audio/            # Web Audio capture + local lead/chord analysis
    ├── ui/               # DOM layer
    │   ├── editor-view.js#   Tiered rendering + event delegation (see below)
    │   ├── selection.js  #   Drag/keyboard selection, highlight classes
    │   ├── chords.js     #   Chord regex, popup, vexchords diagrams, insert
    │   ├── keyboard.js   #   Global keydown router
    │   ├── toolbar.js    #   Toolbar + jelly-segmented edit-mode control
    │   ├── modals.js     #   Settings / Text / Legend dialogs
    │   ├── dialogs.js    #   jelly-dialog helpers + confirmDialog()
    │   ├── perform.js    #   Fullscreen auto-scroll mode
    │   ├── toast.js      #   jellyToast wrapper (all notifications)
    │   ├── listen.js     #   Listen popover + transactional phrase entry
    │   ├── tooltip.js    #   Note-name tooltip
    │   ├── theme.js      #   meta theme-color sync with OS scheme
    │   ├── navigation.js #   Arrow-key suppression when switching focus
    │   └── dom.js        #   $, escapeHtml, focusKeyboard (iPad keyboard hook)
    ├── dropbox/
    │   ├── api.js        #   OAuth2 PKCE + Dropbox HTTP API (DOM-free)
    │   └── ui.js         #   Browse/save dialogs, shared entry-list renderer
    └── vendor/
        ├── jelly.js      #   Jelly UI bundle (ESM, vendored for offline)
        ├── globals.js    #   ESM adapter over the classic vendor globals
        ├── vexchords.js  #   Chord diagram rendering (classic script)
        ├── chords-db.js  #   Guitar chord database (classic script)
        └── lz-string.min.js # URL-safe compression (classic script)
```

### Rendering model

Rendering is tiered so typing stays cheap — there is **no full re-render per keystroke**:

| Bus event | Handler | Cost |
|---|---|---|
| `cells-changed {block}` | `syncBlockCells(i)` — update changed cell text only | no DOM creation |
| `cursor-changed` / `selection-changed` | class toggles on cells | trivial |
| `structure-changed` / `document-replaced` / `linelength-changed` | `renderAll()` full rebuild | rare |

All cell and block-button events are **delegated** from the `#editor` container, so rebuilds never re-attach per-cell listeners. Jelly components live only in DOM that never rebuilds on edit (toolbar, dialogs, perform overlay); per-block controls are plain buttons styled to match.

### Data model

```js
blocks = [
  { type: 'tab',  data: [string1[], …, string6[]] },  // char grid, high e first
  { type: 'text', data: "string content" }             // single-line + tab below = docked
];
cur = { block, stringIdx, col };
lineLength = 80;              // 50–120, characters per tab line
editMode = 'replace' | 'shift' | 'insert';
```

State is persisted to `localStorage["ascii_tab_editor_v1"]` after every change (stable format, including migration from the legacy raw-array format).

### Edit modes

- **Replace** (default): typing overwrites the cell; `|` draws a full vertical bar; bars are cleared column-wise
- **Shift**: typing shifts all six strings right; overflow cascades into the next tab block (creating one if needed)
- **Insert**: typing shifts only the active string, and only up to the next aligned bar line when possible (keeps measures aligned); Shift+key forces a full-line shift

### Tests

`npm test` runs Vitest suites over the DOM-free core: the ASCII parser/formatter (round-trips), share-URL encoding (including a **golden pre-refactor fixture** that guards backward compatibility of shared links and saved documents), editing operations (cascade overflow, smart insert/delete, clipboard), the store (undo, selection normalization), and persistence (legacy format migration). Fixtures live in `test/fixtures/golden.json` — do not regenerate them; they encode the pre-refactor behavior.

### Technical stack

- Vanilla JavaScript (ES modules), HTML5, CSS3 — no framework, no build step
- [Jelly UI](https://jelly-ui.com) web components for the chrome (vendored)
- [vexchords](https://github.com/0xfe/vexchords) + [chords-db](https://github.com/tombatossals/chords-db) for chord diagrams
- [lz-string](https://pieroxy.net/blog/pages/lz-string/index.html) for share URLs
- Service worker PWA (offline-capable), localStorage persistence
- Compatibility: modern desktop browsers + iPad Safari/Chrome
