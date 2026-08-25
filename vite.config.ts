import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
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
