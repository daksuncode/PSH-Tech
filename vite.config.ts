import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // MapLibre alone is ~1 MB minified; it is already split into its own lazy chunk.
    chunkSizeWarningLimit: 1100,
  },
});
