// Shared dialog helpers over <jelly-dialog> (native Escape/backdrop handling
// and focus trap). Closing always returns focus to the hidden keyboard input
// so iPads keep their on-screen keyboard.

import { focusKeyboard } from "./dom.js";

export const openDialog = (el) => {
  if (!el) return;
  if (!el.dataset.wiredClose) {
    el.dataset.wiredClose = "1";
    el.addEventListener("close", () => {
      requestAnimationFrame(() => focusKeyboard());
    });
  }
  el.open = true;
};

export const closeDialog = (el) => {
  if (el) el.open = false;
};

export const isDialogOpen = (el) => !!el?.open;

// Promise-based confirmation dialog (replaces window.confirm).
export const confirmDialog = ({ message, confirmLabel = "OK", cancelLabel = "Cancel" }) =>
  new Promise((resolve) => {
    // Fallback when the Jelly bundle is unavailable.
    if (!customElements.get("jelly-dialog")) {
      resolve(window.confirm(message));
      return;
    }

    const dialog = document.createElement("jelly-dialog");
    dialog.setAttribute("label", "Confirm");
    dialog.innerHTML = `
      <p class="confirm-message"></p>
      <div class="dialog-actions">
        <jelly-button size="small" variant="platinum" data-role="cancel" class="tb-btn"></jelly-button>
        <jelly-button size="small" variant="rose" data-role="confirm" class="tb-btn"></jelly-button>
      </div>
    `;
    dialog.querySelector(".confirm-message").textContent = message;
    dialog.querySelector('[data-role="cancel"]').textContent = cancelLabel;
    dialog.querySelector('[data-role="confirm"]').textContent = confirmLabel;

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      dialog.open = false;
      resolve(result);
    };

    dialog.querySelector('[data-role="cancel"]').addEventListener("click", () => finish(false));
    dialog.querySelector('[data-role="confirm"]').addEventListener("click", () => finish(true));
    dialog.addEventListener("close", () => {
      finish(false);
      setTimeout(() => dialog.remove(), 500);
      requestAnimationFrame(() => focusKeyboard());
    });

    document.body.appendChild(dialog);
    dialog.open = true;
  });
