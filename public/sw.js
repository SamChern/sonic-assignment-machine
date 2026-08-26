// Temporary SonicSIM app-shell cleanup worker.
// Replaces the previous Workbox service worker at the same path so Safari dock
// shortcuts and installed PWAs stop serving an old cached build.
const SW_VERSION = "cleanup-2";

function isAppCacheForThisRegistration(name) {
  const isSonicSimCache = name.startsWith("sonicsim-");
  const isWorkboxAppCache = /(^|-)precache-v\d+-|(^|-)runtime-|(^|-)googleAnalytics-/.test(name);
  return isSonicSimCache || (isWorkboxAppCache && name.endsWith(self.registration.scope));
}

async function purgeAndReloadClients() {
  const cacheNames = await caches.keys();
  const appCacheNames = cacheNames.filter(isAppCacheForThisRegistration);
  await Promise.allSettled(appCacheNames.map((name) => caches.delete(name)));
  await self.clients.claim();
  const windowClients = await self.clients.matchAll({ type: "window" });
  await Promise.allSettled(windowClients.map((client) => client.navigate(client.url)));
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "GET_VERSION") {
    const reply = { type: "SW_VERSION", version: SW_VERSION, scope: self.registration.scope };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(reply);
    else if (event.source) event.source.postMessage(reply);
    return;
  }
  if (type === "SKIP_WAITING" || type === "FORCE_UPDATE") {
    event.waitUntil(
      (async () => {
        await self.skipWaiting();
        try {
          await purgeAndReloadClients();
        } finally {
          await self.registration.unregister();
        }
      })(),
    );
  }
});

self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        await purgeAndReloadClients();
      } finally {
        await self.registration.unregister();
      }
    })(),
  ),
);
