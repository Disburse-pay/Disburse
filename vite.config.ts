import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // Dynamic's embedded-wallet dependencies reference missing ESM files in this SDK line.
      "@msgpack/msgpack": path.resolve(__dirname, "node_modules/@msgpack/msgpack/dist.cjs/index.cjs"),
      "@turnkey/http": path.resolve(__dirname, "node_modules/@turnkey/http/dist/index.js"),
    },
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false
  },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendors into separate, long-cached chunks so the entry
        // chunk stays small (the mobile pay page downloads far less up front)
        // and app updates don't bust the wallet/chart/pdf caches.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          const path = id.replace(/\\/g, "/");
          if (path.includes("/pdf-lib/")) return "pdf";
          if (path.includes("/recharts/") || path.includes("/d3-") || path.includes("/victory")) return "charts";
          if (
            path.includes("/@dynamic-labs/") ||
            path.includes("/@turnkey/") ||
            path.includes("/@walletconnect/")
          ) {
            return "wallet";
          }
          if (
            path.includes("/viem/") ||
            path.includes("/@noble/") ||
            path.includes("/ox/") ||
            path.includes("/abitype/")
          ) {
            return "viem";
          }
          if (
            path.includes("/react/") ||
            path.includes("/react-dom/") ||
            path.includes("/scheduler/")
          ) {
            return "react";
          }
          return undefined;
        }
      }
    }
  }
});
