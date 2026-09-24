import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  retries: 0,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:8890",
    headless: true,
    reducedMotion: "reduce",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 8890",
    url: "http://127.0.0.1:8890",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
