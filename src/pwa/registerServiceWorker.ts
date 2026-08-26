// Single, guarded entry point for app-shell service worker registration.
//
// Offline caching must never be active inside the Lovable editor preview, an
// iframe, or dev: a service worker is browser-held state and would keep serving
// stale HTML/chunks after every edit. In any refused context we also unregister
// a previously installed /sw.js so returning browsers recover automatically.

const SW_URL = "/sw.js";

export const SW_UPDATE_EVENT = "sonicsim:sw-update-available";

let waitingWorker: ServiceWorker | null = null;
let reloadingForController = false;

function isPreviewHost(hostname: string): boolean {
  return (
    hostname.startsWith("id-preview--") ||
    hostname.startsWith("preview--") ||
    hostname === "lovableproject.com" ||
    hostname.endsWith(".lovableproject.com") ||
    hostname === "lovableproject-dev.com" ||
    hostname.endsWith(".lovableproject-dev.com") ||
    hostname === "beta.lovable.dev" ||
    hostname.endsWith(".beta.lovable.dev")
  );
}

function shouldRegister(): boolean {
  if (!import.meta.env.PROD) return false;
  if (window.self !== window.top) return false; // iframe (editor preview)
  if (isPreviewHost(window.location.hostname)) return false;
  if (new URLSearchParams(window.location.search).get("sw") === "off") return false;
  return true;
}

async function unregisterAppWorkers(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.allSettled(
    registrations
      .filter((r) => {
        const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
        // Only our app-shell worker — leave messaging workers (FCM, etc.) alone.
        return url.endsWith(SW_URL);
      })
      .map((r) => r.unregister()),
  );
}

function announceUpdate(worker: ServiceWorker) {
  waitingWorker = worker;
  window.dispatchEvent(new CustomEvent(SW_UPDATE_EVENT));
}

function reloadOnNewController(): void {
  if (reloadingForController) return;
  reloadingForController = true;
  window.location.reload();
}

/** Activate the waiting worker and reload once it takes control. */
export function applyServiceWorkerUpdate(): void {
  const worker = waitingWorker;
  if (!worker) {
    window.location.reload();
    return;
  }
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
  // Fallback in case the worker never reports a controller change.
  window.setTimeout(() => {
    if (!reloaded) {
      reloaded = true;
      window.location.reload();
    }
  }, 3000);
}

/**
 * Compare the build stamp compiled into this bundle with the one currently
 * deployed. A mismatch means the browser (HTTP cache, CDN edge, or an installed
 * PWA shell) is running an older release, so we purge caches and hard-reload
 * once. Works with or without a service worker.
 */
let recovering = false;
async function recoverIfStale(): Promise<void> {
  if (recovering || !import.meta.env.PROD) return;
  try {
    const res = await fetch(`/build-info.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const { buildId } = (await res.json()) as { buildId?: string };
    if (!buildId || buildId === __APP_BUILD_ID__) return;

    recovering = true;
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.allSettled(keys.map((k) => caches.delete(k)));
    }
    await unregisterAppWorkers();
    window.location.reload();
  } catch {
    // Offline or blocked — keep serving what we have.
  }
}

function watchForStaleBuild(): void {
  void recoverIfStale();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void recoverIfStale();
  });
  window.setInterval(() => void recoverIfStale(), 5 * 60 * 1000);
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) {
    watchForStaleBuild();
    return;
  }

  if (!shouldRegister()) {
    void unregisterAppWorkers();
    return;
  }

  watchForStaleBuild();

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      // updateViaCache: "none" keeps the browser from serving /sw.js from its
      // HTTP cache, which is the usual reason a deploy never reaches a client.
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        navigator.serviceWorker.addEventListener("controllerchange", reloadOnNewController);
        void registration.update();

        if (registration.waiting && navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting;
          applyServiceWorkerUpdate();
          return;
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              announceUpdate(installing);
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });

        // Periodic check so long-lived tabs still learn about new deploys.
        window.setInterval(() => void registration.update(), 15 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update();
        });
      })
      .catch((err) => {
        console.warn("Service worker registration failed", err);
      });
  });
}
