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
    port: 5173,
    strictPort: false
  }
});
