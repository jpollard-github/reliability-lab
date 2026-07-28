import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  ...(process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? {}
    : {
        webServer: [
          {
            command: "ENABLE_FAILURE_INJECTION=true pnpm --dir ../.. dev:api",
            url: "http://127.0.0.1:4000/healthz",
            reuseExistingServer: true,
            timeout: 60_000,
          },
          {
            command: "pnpm dev",
            url: "http://127.0.0.1:3000",
            reuseExistingServer: true,
            timeout: 60_000,
          },
        ],
      }),
});
