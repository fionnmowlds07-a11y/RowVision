import { defineConfig, devices } from "@playwright/test";

const browser = process.env.CHROME_PATH
  ? { launchOptions: { executablePath: process.env.CHROME_PATH } }
  : { channel: "chrome" }; // Playwright's own Chromium has no H.264.

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [
    { name: "laptop", use: { ...devices["Desktop Chrome"], ...browser, viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 7"], ...browser } },
  ],
});
