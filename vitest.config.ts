import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
    // The workbench tests drive many real user interactions through the rendered application. Under a
    // full parallel run the default five seconds is not enough for the longest flows.
    testTimeout: 20_000,
    exclude: [
      "tests/browser/**",
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "dist-web/**",
      "dist-docker/**",
      "scripts/**",
    ],
  },
});
