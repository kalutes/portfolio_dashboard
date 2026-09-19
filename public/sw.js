/* Only a generic offline document is cached. Financial pages/API/RSC data are never cached. */
const SHELL = "portfolio-shell-v1";
const OFFLINE = "/offline.html";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then(async (cache) => {
      await cache.add(new Request(OFFLINE, { cache: "reload" }));
      await self.skipWaiting();
    }),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("portfolio-shell-") && key !== SHELL)
          await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  // Includes neither Next server actions nor JSON / React Server Component requests.
  if (event.request.method !== "GET" || event.request.mode !== "navigate")
    return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      try {
        return await fetch(event.request, { cache: "no-store" });
      } catch {
        const fallback = await (await caches.open(SHELL)).match(OFFLINE);
        return (
          fallback ||
          new Response(
            "Offline. Reconnect to Tailscale and reload Portfolio.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain",
                "Cache-Control": "no-store",
              },
            },
          )
        );
      }
    })(),
  );
});
