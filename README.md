# ASCII Guitar Tab Editor

Lightweight, offline, iPad-compatible web app for creating ASCII-style guitar tabs.

## Architecture

### File Structure
```
tabeditor/
├── tabeditor.html    # Main application
├── styles.css        # Complete styling
├── manifest.json     # PWA manifest
├── icon-192.png      # App icon (192x192)
├── icon-512.png      # App icon (512x512)
└── js/               # All JavaScript files
    ├── state.js           # Data model, cursor, undo system
    ├── storage.js         # localStorage, import/export
    ├── rendering.js       # DOM generation and updates
    ├── editing.js         # Tab operations and edit modes
    ├── keyboard.js        # Keyboard event handling
    ├── ui-interactions.js # Mouse/touch and modal helpers
    ├── main.js           # Initialization and coordination
    └── sw.js             # Service worker for PWA offline support
```

**Note**: All JavaScript files must be placed in the `js/` directory.

### Data Model

```js
blocks = [
  { type: 'tab', data: [string1[], string2[], ..., string6[]] },
  { type: 'text', data: "string content" }
];
cur = { block, stringIdx, col };
lineLength = 80; // characters per line
editMode = 'replace' | 'shift' | 'insert';
```

### Key Functions

| Module | Function | Purpose |
|--------|----------|---------|
| **state.js** | `makeEmptyBlock(len)` | Create 6-string tab block filled with `-` |
| | `setCursor(b, s, c)` | Set cursor and update display |
| | `saveUndoState()` | Snapshot state for undo |
| **rendering.js** | `render()` | Full DOM rebuild from blocks |
| | `updateCursorOnly()` | Lightweight cursor repositioning |
| **editing.js** | `handlePrintable(ch)` | Insert/replace character |
| | `insertCharacterAtCursor()` | Cascade insert across blocks |
| | `applyLength(L)` | Resize all tab blocks |
| | `copySelectionFromBlock(idx)` | Capture rectangular tab selections |
| | `pasteClipboardIntoBlock(idx)` | Paste clipboard respecting edit mode |
| **keyboard.js** | `onKeyDown(e)` | Route keyboard input |
| **storage.js** | `save()` / `load()` | localStorage persistence |

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

```js
localStorage["ascii_tab_editor_v1"] = {
  blocks: [...],
  lineLength: 80,
  cursor: { block, stringIdx, col },
  editMode: 'replace' | 'shift' | 'insert'
}
```

## Extension Guidelines

### Maintaining Grid Alignment
- All DOM changes must preserve monospace consistency
- Character cells must use `.ch` class with fixed-width font
- Avoid inline styles that override CSS positioning

### Adding Features
- **State changes**: Use `saveUndoState()` before mutations
- **Display updates**: Call `render()` or `updateCursorOnly()`
- **Persistence**: Call `save()` after data changes
- **Module placement**:
  - Data operations → `editing.js`
  - UI elements → `ui-interactions.js` or `rendering.js`
  - Input handling → `keyboard.js`

### Common Pitfalls
- **Cursor offset**: Button elements in `.block` affect child indexing — use `querySelectorAll('.line')` not `:nth-child()`
- **Insert mode**: Must fill non-active strings with `-` when shifting
- **Vertical bars**: Clear entire column before modifying individual string

### Event Binding
- Click handlers bound during `render()` in `rendering.js`
- Global keyboard in `keyboard.js` via `document.addEventListener`
- Modal interactions in `ui-interactions.js` setup functions

## Technical Stack

- **Language**: Vanilla JavaScript (ES6+)
- **Frameworks**: None
- **Storage**: localStorage
- **Compatibility**: Desktop + iPad Safari/Chrome
- **Dependencies**: Zero

## Load Order

1. `state.js` — Core data structures
2. `storage.js` — Persistence layer
3. `rendering.js` — Display logic
4. `editing.js` — Business logic
5. `keyboard.js` — Input handling
6. `ui-interactions.js` — UI components
7. `main.js` — Bootstrap and coordination
