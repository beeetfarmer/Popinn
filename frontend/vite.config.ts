import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

const proxyTarget = process.env.VITE_API_PROXY_TARGET || "http://localhost:8471";

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
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
