# ASCII Guitar Tab Editor

**🎸 [Try it live on GitHub Pages](https://planbnet.github.io/guitartabs/)**

A 99% vibe-coded lightweight, offline-capable web application for creating and editing ASCII-style guitar tablature. Works seamlessly on desktop browsers and iPad devices with full keyboard and touch support.

## What It Does

This editor lets you create professional guitar tabs using ASCII characters, the standard format used across the internet for sharing guitar music. You can:

- **Create tab blocks**: Add tablature sections with 6 strings (standard guitar tuning: E-A-D-G-B-e)
- **Add text blocks**: Insert lyrics, chord names, or annotations between tab sections
- **Edit with three modes**: Choose between Replace, Shift, or Insert modes depending on your workflow
- **Visual chord diagrams**: Type chord names (e.g., "C", "Am7", "D#m") and click them to see fingering diagrams
- **Navigate efficiently**: Use arrow keys, keyboard shortcuts, or mouse/touch to move around
- **Undo mistakes**: Full undo history keeps your work safe
- **Work offline**: Install as a Progressive Web App (PWA) and use without internet

## Import & Export

The **Text** button opens a popup window that shows your entire tab as plain text. This is your hub for importing and exporting tabs:

### Exporting
1. Click the **Text** button in the toolbar
2. Your complete tab appears in the text area
3. Click **Export** to download as a `.txt` file
   - If the first line is text followed by an empty line, it will be used as the filename
   - Otherwise, defaults to `guitar-tab.txt`

### Importing
1. Click the **Text** button in the toolbar
2. Choose an import method:
   - **Import File**: Browse and select a `.txt` tab file from your device
   - **Import Clipboard**: Paste tab text you've already copied
   - **Manual entry**: Type or paste directly into the text area, then click **Update**

The parser intelligently detects tab blocks (6 consecutive lines starting with string labels like `e|`, `B|`, etc.) and text blocks. Empty lines separate blocks. Tab blocks maintain alignment while text blocks preserve line breaks.

## Share via URL

The **Share** button (in the Text modal) generates a shareable URL that includes your entire tab:

1. Click the **Text** button, then click **Share**
2. A URL is automatically copied to your clipboard
3. Share this URL with anyone — they can open it to instantly load your tab

### How It Works
- Tab data is compressed using [LZ-String](https://pieroxy.net/blog/pages/lz-string/index.html) algorithm
- Compressed data is added as a URL parameter (`?tab=...`)
- URLs are validated to stay under 2,000 characters for maximum browser compatibility
- When someone opens a shared URL, the tab loads automatically

### URL Length Considerations
- **Small tabs** (5-10 measures): ~300-800 characters ✅
- **Medium tabs** (10-15 measures): ~800-1,500 characters ✅  
- **Large tabs** (20+ measures): May exceed 2,000 character limit ⚠️

If your tab is too large to share via URL, use the Export function to save as a `.txt` file instead.

## Dropbox Integration

Connect to your Dropbox account to open and save tab files directly from the cloud — no server required.

### Setup
1. The app uses Dropbox OAuth2 with PKCE (no secret needed, safe for public repos)
2. Click **Settings** → **Connect to Dropbox** to authorize
3. Choose a folder in your Dropbox to use as your tab library

### Usage
- **Open**: Click the **Open** button in the toolbar to browse and load `.txt` files from your Dropbox folder
- **Save**: Click the **Save** button to write back to Dropbox — previously opened files are auto-overwritten, new files prompt for a filename
- Your selected folder and current file are remembered in localStorage across sessions
- Tokens auto-refresh so you stay connected

## Perform Mode

A fullscreen auto-scrolling view for playing along to your tabs.

### Entering Perform Mode
Click the green **Perform** button in the toolbar. The editor is replaced by a large, read-only view of your tab optimized for reading at a distance.

### Scroll Behavior
- All content (text lines and tab blocks) scrolls continuously at a steady rate
- Speed is measured in **seconds per line** — adjustable in 0.5s increments
- When you press Play, a brief **countdown** delays scrolling so you can read the first screen of content — a green progress bar at the top of the screen shows the remaining wait time
- Scrolling manually during the countdown skips the wait immediately

### Controls (bottom bar)
| Button | Action |
|--------|--------|
| ⏮ | Reset to top |
| ▶ / ⏸ | Play / Pause auto-scroll |
| − / + | Decrease / Increase seconds per line |
| ⛶ | Toggle browser fullscreen |
| ✕ | Exit perform mode |

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Space | Play / Pause |
| + / = | Increase delay (slower) |
| - | Decrease delay (faster) |
| F | Toggle fullscreen |
| ↑ / ← | Scroll up manually |
| ↓ / → | Scroll down manually |
| Escape | Exit perform mode |

### Font Sizing
The font is automatically calculated to be as large as possible while still fitting the full tab width on screen. It recalculates on window resize.

## Chord Shape Diagrams

When you type a chord name in a text block (like `C`, `Gmaj7`, or `F#m`), it becomes clickable. Clicking the chord name displays an interactive popup showing:

- **Visual fret diagram**: Rendered using [vexchords](https://github.com/0xfe/vexchords), a JavaScript library for drawing beautiful chord charts
- **Multiple fingering positions**: Navigate through alternative ways to play the same chord using arrow buttons
- **Chord data**: Powered by [chords-db](https://github.com/tombatossals/chords-db), a comprehensive database of guitar chord positions

The libraries work together: `chords-db` provides the fingering positions (which frets to press on which strings), and `vexchords` renders them as standard chord diagrams.

## Architecture

### File Structure
```
guitartabs/
├── index.html        # Main application
├── styles.css        # Complete styling
├── manifest.json     # PWA manifest
├── icon-192.png      # App icon (192x192)
├── icon-512.png      # App icon (512x512)
└── js/               # All JavaScript files
    ├── state.js           # Data model, cursor, undo system
    ├── storage.js         # localStorage, import/export
    ├── dropbox.js         # Dropbox OAuth2 PKCE + API integration
    ├── perform.js         # Fullscreen auto-scrolling perform mode
    ├── rendering.js       # DOM generation, updates, chord diagrams
    ├── editing.js         # Tab operations and edit modes
    ├── keyboard.js        # Keyboard event handling
    ├── ui-interactions.js # Mouse/touch and modal helpers
    ├── main.js            # Initialization and coordination
    ├── sw.js              # Service worker for PWA offline support
    └── vendor/
        ├── vexchords.js   # Chord diagram rendering library
        └── chords-db.js   # Guitar chord fingering database
```

### Data Model

```js
blocks = [
  { type: 'tab', data: [string1[], string2[], ..., string6[]] },
  { type: 'text', data: "string content" }
];
cursor = { block, stringIdx, col };
lineLength = 80; // characters per line for tab blocks
editMode = 'replace' | 'shift' | 'insert';
```

### Key Functions

| Module | Function | Purpose |
|--------|----------|---------|
| **state.js** | `makeEmptyBlock(len)` | Create 6-string tab block filled with `-` |
| | `setCursor(b, s, c)` | Set cursor position and update display |
| | `saveUndoState()` | Snapshot current state for undo history |
| **rendering.js** | `render()` | Full DOM rebuild from blocks array |
| | `updateCursorOnly()` | Lightweight cursor repositioning without re-render |
| | `findChordData(name)` | Look up chord fingering positions from chords-db |
| | `drawChordDiagram(...)` | Render chord shape using vexchords library |
| **editing.js** | `handlePrintable(ch)` | Insert/replace character based on edit mode |
| | `insertCharacterAtCursor()` | Cascade insert operation across blocks |
| | `applyLength(L)` | Resize all tab blocks to new line length |
| | `copySelectionFromBlock(idx)` | Capture rectangular tab selections |
| | `pasteClipboardIntoBlock(idx)` | Paste clipboard data respecting edit mode |
| **keyboard.js** | `onKeyDown(e)` | Route and handle all keyboard input |
| **storage.js** | `save()` / `load()` | localStorage persistence |
| | `exportToFile()` | Download current tab as `.txt` file (auto-detects title) |
| | `importFromFile()` / `importFromClipboard()` | Parse and load external tab content |
| | `shareTab()` | Generate compressed shareable URL |
| | `loadFromUrl()` | Load tab from URL parameter on page load |
| **dropbox.js** | `dbxStartAuth()` / `dbxHandleRedirect()` | OAuth2 PKCE authentication flow |
| | `dbxOpenFile()` / `dbxSaveFile()` | Open/save files from Dropbox |
| | `dbxListFolder()` | Browse Dropbox folder contents |
| **perform.js** | `enterPerformMode()` / `exitPerformMode()` | Manage fullscreen overlay lifecycle |
| | `performScrollTick()` | Hybrid scroll engine (smooth text + tab snap-out) |
| | `calculatePerformFontSize()` | Binary search for optimal monospace font size |

## DOM Structure

### Tab Block
```html
<div class="block tab-block">
  <div class="block-controls">...</div>
  <button class="block-remove-handle">×</button>
  <div class="line">
    <span class="label">e|</span>
    <div class="chars">
      <span class="ch">-</span>
      <span class="ch cursor">5</span>
      <!-- ... 90 chars total ... -->
    </div>
  </div>
  <!-- ... 6 strings total ... -->
</div>
```

### Critical CSS Classes
- `.line` — String container (16px monospace font)
- `.chars` — Character grid wrapper
- `.ch` — Individual character cell
- `.cursor` — Active cursor highlight

**Important**: `updateCursorOnly()` uses `querySelectorAll('.line')[index]` to avoid counting button elements.

## Edit Modes

### Replace Mode (default)
- Typing replaces character at cursor
- Vertical bars (`|`) clear entire column before replacing

### Shift Mode
- Typing inserts by shifting all six strings to the right
- Overflow cascades to the next tab block (creating one if needed)
- Non-active strings receive `-` at the insertion column to keep alignment

### Insert Mode
- Typing shifts only the active string while other strings stay untouched
- Overflow still cascades along that string into following tab blocks
- Clipboard pastes shift only the affected strings (unless all 6 strings are pasted)

## Storage

Application state is persisted to `localStorage` automatically after each change:

```js
localStorage["ascii_tab_editor_v1"] = JSON.stringify({
  blocks: [...],      // Array of tab and text blocks
  lineLength: 80,     // Current line length setting
  cursor: { block, stringIdx, col },
  editMode: 'replace' | 'shift' | 'insert'
});
```

The storage system uses the key `ascii_tab_editor_v1` to maintain state across browser sessions. Content is automatically saved after every edit, ensuring no work is lost.

## Extension Guidelines

### Maintaining Grid Alignment
- All DOM changes must preserve monospace consistency
- Character cells must use `.ch` class with fixed-width font (16px Menlo/Monaco/Consolas)
- Avoid inline styles that override CSS positioning
- Tab blocks maintain strict character alignment across all 6 strings

### Adding Features
- **State changes**: Use `saveUndoState()` before mutations to enable undo
- **Display updates**: Call `render()` for full updates or `updateCursorOnly()` for cursor-only changes
- **Persistence**: Call `save()` after data changes to update localStorage
- **Module placement**:
  - Data operations → `editing.js`
  - UI elements → `ui-interactions.js` or `rendering.js`
  - Input handling → `keyboard.js`
  - Storage/import/export → `storage.js`

### Common Pitfalls
- **Cursor offset**: Button elements in `.block` affect child indexing — use `querySelectorAll('.line')` not `:nth-child()`
- **Insert mode**: Must fill non-active strings with `-` when shifting to maintain alignment
- **Vertical bars**: Clear entire column before modifying individual string
- **Chord detection**: Chord names are clickable only in text blocks, not within tab notation

### Event Binding
- Click handlers bound during `render()` in `rendering.js`
- Global keyboard events in `keyboard.js` via `document.addEventListener`
- Modal interactions setup in `ui-interactions.js`
- Chord popup interactions managed in `rendering.js`

## Technical Stack

- **Languages**: Vanilla JavaScript (ES6+), HTML5, CSS3
- **Frameworks**: None (zero framework dependencies)
- **Storage**: localStorage API for persistence
- **Offline Support**: Service Worker (PWA)
- **Libraries**: 
  - [vexchords](https://github.com/0xfe/vexchords) - SVG chord diagram rendering
  - [chords-db](https://github.com/tombatossals/chords-db) - Comprehensive chord position database
  - [lz-string](https://pieroxy.net/blog/pages/lz-string/index.html) - URL-safe compression for sharing
- **Compatibility**: Modern desktop browsers + iPad Safari/Chrome
- **Build Tools**: None required (runs directly in browser)
