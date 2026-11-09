import { defineConfig } from "@playwright/test";

// Starts the installed app rather than the one in the source folder. Run after `npm run dist`.
export default defineConfig({
  testDir: "tests/packaged",
  timeout: 90_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
});
