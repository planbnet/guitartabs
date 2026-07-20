// Tiny event bus decoupling core state/logic from the UI.
//
// Events:
//   cells-changed      {block}  cell data changed inside an existing tab block
//   structure-changed  -        blocks added/removed/moved or docking flipped
//   document-replaced  -        whole document swapped (load/import/undo)
//   linelength-changed -        line length changed (grid must rebuild)
//   cursor-changed     -        cursor moved
//   selection-changed  -        selection rectangle changed
//   clipboard-changed  -        internal clipboard filled/cleared
//   editmode-changed   -        replace/shift/insert mode switched
//   dirty              -        state should be persisted

const target = new EventTarget();

export const on = (type, fn) => {
  target.addEventListener(type, (e) => fn(e.detail));
};

export const emit = (type, detail) => {
  target.dispatchEvent(new CustomEvent(type, { detail }));
};
