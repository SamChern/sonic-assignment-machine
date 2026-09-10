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
        // Keep the entry chunk under the reviewed bundle budget by pulling the
        // big third-party libraries into their own long-cached chunks.
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return "vendor-react";
          }
          if (id.includes("@supabase")) return "vendor-supabase";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (/[\\/]node_modules[\\/](d3|d3-[a-z]+|recharts|victory-vendor)[\\/]/.test(id)) {
            return "vendor-charts";
          }
          return undefined;
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
