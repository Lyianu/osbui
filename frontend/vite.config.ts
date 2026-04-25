import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://127.0.0.1:5173",
      "/panel": "http://127.0.0.1:5173",
      "/sandbox-proxy": {
        target: "http://127.0.0.1:5173",
        ws: true,
        changeOrigin: false,
      },
    },
  },
})
