import { defineConfig } from "@playwright/test";

const durableEnvironment = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://reliability:reliability@127.0.0.1:5432/reliability_lab",
  EXECUTION_MODE: "postgres_worker",
  EXECUTION_COMMAND_ACTIVE_KEY_VERSION: "e2e-v1",
  EXECUTION_COMMAND_KEYS_JSON: JSON.stringify({
    "e2e-v1": Buffer.alloc(32, 21).toString("base64"),
  }),
  REPLAY_CAPSULE_STORE: "postgres",
  REPLAY_CAPSULE_ACTIVE_KEY_VERSION: "e2e-v1",
  REPLAY_CAPSULE_KEYS_JSON: JSON.stringify({
    "e2e-v1": Buffer.alloc(32, 22).toString("base64"),
  }),
  WORKER_POLL_INTERVAL_MS: "500",
  WORKER_HEALTH_PORT: "4001",
  OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:4010/v1",
  OPENAI_API_KEY: "local-playwright-provider-key",
  OPENAI_MODEL: "local-playwright-model",
};

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
            command: "pnpm --dir ../.. dev:provider-mock",
            url: "http://127.0.0.1:4010/healthz",
            reuseExistingServer: false,
            timeout: 60_000,
          },
          {
            command: "pnpm --dir ../.. db:migrate && pnpm --dir ../.. dev:api",
            url: "http://127.0.0.1:4000/healthz",
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              ...process.env,
              ...durableEnvironment,
              ENABLE_FAILURE_INJECTION: "true",
              API_PORT: "4000",
            },
          },
          {
            command: "pnpm --dir ../.. dev:worker",
            url: "http://127.0.0.1:4001/healthz",
            reuseExistingServer: false,
            timeout: 60_000,
            env: { ...process.env, ...durableEnvironment },
          },
          {
            command: "pnpm dev",
            url: "http://127.0.0.1:3000",
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ],
      }),
});
