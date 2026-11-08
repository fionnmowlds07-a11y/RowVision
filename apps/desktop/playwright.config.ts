import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/app",
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
