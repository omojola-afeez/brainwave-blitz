import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// CI installs its own browser. This only helps where a different build is preinstalled.
const local = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const executablePath = process.env.PW_CHROMIUM ?? (existsSync(local) ? local : undefined);

export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-results.json" }]],
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "node dist/server/index.js",
    url: "http://127.0.0.1:3100/healthz",
    reuseExistingServer: false,
    env: { PORT: "3100", BLITZ_TIMING: "fast", LOG_LEVEL: "warn", MAX_ROOMS: "50" },
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
});
