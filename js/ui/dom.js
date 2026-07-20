// Small DOM helpers shared by the UI modules.

export const $ = (id) => document.getElementById(id);

export const escapeHtml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Hidden input that summons the on-screen keyboard on iPad. All key input
// for the tab grid is captured at the document level; this element only
// exists so touch devices show a keyboard.
const kbd = () => $("kbd");

export const focusKeyboard = () => {
  const el = kbd();
  if (!el) return;
  if (document.activeElement === el) return;
  el.focus({ preventScroll: true });
};

export const isAnyDialogOpen = () => {
  if (document.querySelector("jelly-dialog[open]")) return true;
  // Legacy .modal dialogs during migration.
  return Array.from(document.querySelectorAll(".modal")).some(
    (modal) => modal.style.display === "flex" || modal.style.display === "block"
  );
};
