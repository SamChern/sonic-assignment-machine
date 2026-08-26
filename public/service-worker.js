// Legacy app-shell cleanup worker. Keep this in sync with /sw.js for browsers
// that may have registered an older service-worker filename.
function isAppCacheForThisRegistration(name) {
  const isSonicSimCache = name.startsWith("sonicsim-");
  const isWorkboxAppCache = /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name);
  return isSonicSimCache || (isWorkboxAppCache && name.endsWith(self.registration.scope));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        const appCacheNames = cacheNames.filter(isAppCacheForThisRegistration);
        await Promise.allSettled(appCacheNames.map((name) => caches.delete(name)));
        await self.clients.claim();
        const windowClients = await self.clients.matchAll({ type: "window" });
        await Promise.allSettled(windowClients.map((client) => client.navigate(client.url)));
      } finally {
        await self.registration.unregister();
      }
    })(),
  ),
);