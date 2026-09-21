/*
 * Service worker: the reason the app still opens when the network is gone.
 *
 * It keeps two stores. SHELL holds the app itself, cached on install. PACK is written by the app
 * when the user downloads a region. A request is answered from the shell, then from the pack,
 * and only then from the network.
 */

const SHELL = "guidebook-shell-v1";
const PACK = "guidebook-pack-v1";
const FILES = ["./", "index.html", "app.js", "pack-embed.js"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // Added one by one: pack-embed.js only exists in the published build, and one missing
    // file must not stop the rest of the shell being stored.
    await Promise.allSettled(FILES.map((file) => shell.add(new Request(file, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== SHELL && name !== PACK) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith((async () => {
    for (const store of [SHELL, PACK]) {
      const cache = await caches.open(store);
      const stored = await cache.match(event.request, { ignoreSearch: true });
      if (stored) return stored;
    }
    try {
      return await fetch(event.request);
    } catch {
      return new Response("Offline, and this file is not in the region pack.",
                          { status: 504, headers: { "Content-Type": "text/plain" } });
    }
  })());
});
