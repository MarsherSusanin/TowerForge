import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  use: {
    browserName: "chromium",
    viewport: { width: 1280, height: 820 },
    trace: "retain-on-failure"
  }
});
