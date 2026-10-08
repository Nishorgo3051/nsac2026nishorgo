/*
  Service worker: it keeps the instrument itself openable when there is no network.

  Division of labour, on purpose:
    THIS WORKER  caches the shell - the page, the script, itself and the typeface.
    THE APP      caches the pack separately, under its own key, because the pack is megabytes and
                 is replaced on its own schedule when a newer observation arrives.

  Nothing here asks the network to decide what to serve: a cached shell is served first, always,
  so opening the instrument never waits on a dying connection.
*/

// Bump on every change to the shell files: the browser only re-installs this worker when this
// file's bytes change, so without a bump a phone keeps serving the old page from its cache.
const SHELL = "ingito-shell-v10";
// Marks replies this worker invents while offline, so the page's connectivity check can tell them
// apart from real answers that came over the network.
const OFFLINE_HEADER = { "Content-Type": "text/plain", "X-Ingito-Offline": "1" };
const FILES = ["./", "index.html", "app.js", "sw.js",
               "fonts/inter-latin.woff2", "fonts/inter-latin-ext.woff2", "fonts/hind-siliguri-bengali-400.woff2",
               "fonts/hind-siliguri-bengali-600.woff2", "fonts/hind-siliguri-bengali-700.woff2",
               "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (event) => {
  // allSettled, not all: one missing file must not leave the instrument with no cached shell.
  event.waitUntil(
    caches.open(SHELL)
      .then((cache) => Promise.allSettled(
        FILES.map((file) => cache.add(new Request(file, { cache: "reload" })))))
      .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("ingito-shell-") && key !== SHELL)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Connectivity probes must reach the real network. Answering them from the cache would make the
  // instrument report ONLINE forever, which is the one lie the status strip must never tell.
  if (new URL(event.request.url).searchParams.has("probe")) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response("offline", { status: 504, headers: OFFLINE_HEADER })));
    return;
  }
  event.respondWith((async () => {
    const shell = await caches.open(SHELL);
    const hit = await shell.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(event.request);
    } catch (error) {
      // Offline and not on the device. Say so plainly rather than letting the browser show its own
      // error page, which looks as though the instrument itself has failed.
      return new Response("Offline, and this file is not stored on the device.",
                          { status: 504, headers: OFFLINE_HEADER });
    }
  })());
});
