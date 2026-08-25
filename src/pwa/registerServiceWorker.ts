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

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  if (!shouldRegister()) {
    void unregisterAppWorkers();
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(SW_URL, { scope: "/" })
      .then((registration) => {
        navigator.serviceWorker.addEventListener("controllerchange", reloadOnNewController);

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
        window.setInterval(() => void registration.update(), 60 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void registration.update();
        });
      })
      .catch((err) => {
        console.warn("Service worker registration failed", err);
      });
  });
}
