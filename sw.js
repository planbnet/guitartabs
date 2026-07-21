// Service worker: precaches the whole app so it works offline as a PWA.
// Bump CACHE_NAME whenever any cached file changes.

const CACHE_NAME = "tab-editor-v6";

const urlsToCache = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./js/main.js",
  "./js/core/constants.js",
  "./js/core/bus.js",
  "./js/core/model.js",
  "./js/core/store.js",
  "./js/core/editing.js",
  "./js/core/serialize.js",
  "./js/core/share.js",
  "./js/core/persistence.js",
  "./js/ui/dom.js",
  "./js/ui/theme.js",
  "./js/ui/tooltip.js",
  "./js/ui/chords.js",
  "./js/ui/selection.js",
  "./js/ui/editor-view.js",
  "./js/ui/navigation.js",
  "./js/ui/keyboard.js",
  "./js/ui/toolbar.js",
  "./js/ui/modals.js",
  "./js/ui/dialogs.js",
  "./js/ui/perform.js",
  "./js/ui/pdf.js",
  "./js/ui/toast.js",
  "./js/dropbox/api.js",
  "./js/dropbox/ui.js",
  "./js/vendor/globals.js",
  "./js/vendor/jelly.js",
  "./js/vendor/vexchords.js",
  "./js/vendor/chords-db.js",
  "./js/vendor/lz-string.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never intercept API calls (Dropbox) or anything that is not a plain GET.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: request.mode === "navigate" }).then((cached) => {
      if (cached) return cached;
      if (request.mode === "navigate") {
        return caches.match("./index.html").then((page) => page || fetch(request));
      }
      return fetch(request);
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((name) => (name === CACHE_NAME ? null : caches.delete(name)))
      )
    ).then(() => self.clients.claim())
  );
});
