import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname, "src/entry/web"),
  publicDir: resolve(import.meta.dirname, "public"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, "dist-web"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
