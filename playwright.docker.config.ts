import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/browser-docker",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report-docker", open: "never" }]]
    : "line",
  testMatch: ["**/docker-persistence.spec.ts"],
  use: {
    baseURL: "http://127.0.0.1:4174",
    ...devices["Desktop Chrome"],
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "PORT=4174 DIST_DIR=dist-docker node scripts/serve-production.mjs",
    url: "http://127.0.0.1:4174/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
