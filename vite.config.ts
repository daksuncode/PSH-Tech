import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev:api` serves the Worker (AI API) on 8787.
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    // MapLibre alone is ~1 MB minified; it is already split into its own lazy chunk.
    chunkSizeWarningLimit: 1100,
  },
});
