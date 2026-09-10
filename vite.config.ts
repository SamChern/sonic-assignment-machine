import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

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
    mode === "development" && mcpPlugin(),
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
  ].filter(Boolean),
  build: {
    rollupOptions: {
      output: {
        // Keep the entry chunk under the reviewed bundle budget. All third-party
        // code goes into ONE vendor chunk on purpose: splitting React, Radix and
        // the chart libs into separate chunks reordered their module
        // initialisation and blew up production with a TDZ error
        // ("Cannot access 'P' before initialization") on a blank page.
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return undefined;
          // @supabase has no React coupling, so it is safe to isolate.
          if (id.includes("@supabase")) return "vendor-supabase";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
