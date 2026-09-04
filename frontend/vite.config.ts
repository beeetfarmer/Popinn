import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { readFileSync } from "fs";
import path from "path";

const proxyTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:8471";
// Single source of truth for the app version: package.json, injected at build.
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf-8")
);

export default defineConfig({
  server: {
    host: "::",
    port: 5173,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/media": {
        target: proxyTarget,
        changeOrigin: true,
      },
      "/data": {
        target: proxyTarget,
        changeOrigin: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
