import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// Unique per production build. Emitted to /build-info.json and compiled into the
// bundle so a running client can detect that it is serving a stale deploy.
const BUILD_ID = Date.now().toString(36);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    {
      name: "sonicsim-build-info",
      apply: "build",
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "build-info.json",
          source: JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() }),
        });
      },
    } satisfies Plugin,
    VitePWA({
      strategies: "generateSW",
      registerType: "autoUpdate",
      filename: "sw.js",
      // The existing public/manifest.webmanifest stays the source of truth.
      manifest: false,
      injectRegister: null,
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // The build stamp must never be cached — it is the freshness oracle.
        globIgnores: ["**/build-info.json"],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // Activate the latest app shell immediately so installed clients pick up
        // fresh SonicSIM.ai branding on the next foreground or reload.
        skipWaiting: true,
        // SPA routes (dashboard, admin, semantic analysis, ...) fall back to the
        // cached app shell when the network is unavailable.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [
          /^\/~oauth/,
          /^\/functions\//,
          /^\/api\//,
        ],
        runtimeCaching: [
          {
            // Freshness oracle: always straight to the network.
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname === "/build-info.json",
            handler: "NetworkOnly",
          },
          {
            // HTML navigations: always try the network first so deploys land fast.
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: {
              cacheName: "sonicsim-pages",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
          {
            // Same-origin hashed build assets are immutable.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              url.pathname.startsWith("/assets/") &&
              (request.destination === "script" ||
                request.destination === "style" ||
                request.destination === "font" ||
                request.destination === "image"),
            handler: "CacheFirst",
            options: {
              cacheName: "sonicsim-assets",
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Icons / static images served from public/.
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin && request.destination === "image" && !url.pathname.startsWith("/assets/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "sonicsim-static-images",
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
