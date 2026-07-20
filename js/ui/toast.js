// Single notification path for the whole app.
//
// Uses Jelly UI's global jellyToast (registered by the vendored bundle);
// falls back to alert() if the bundle failed to load, so errors never
// disappear silently.

export const toast = (message, tone = "info") => {
  if (typeof globalThis.jellyToast === "function") {
    globalThis.jellyToast(message, { tone, duration: tone === "danger" ? 6000 : 3500 });
  } else {
    alert(message);
  }
};
