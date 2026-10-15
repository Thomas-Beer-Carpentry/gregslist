import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRODUCTION === "1"
        ? "npm run start"
        : "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
