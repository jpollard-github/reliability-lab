import { describe, expect, it } from "vitest";
import { readWorkerRuntimeConfig } from "../src/config.js";

describe("worker runtime configuration", () => {
  it("uses bounded local defaults", () => {
    expect(readWorkerRuntimeConfig({})).toEqual({
      healthPort: 4_001,
      pollIntervalMs: 250,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      concurrency: 1,
    });
  });

  it("rejects invalid concurrency and heartbeat settings", () => {
    expect(() => readWorkerRuntimeConfig({ WORKER_CONCURRENCY: "17" })).toThrow();
    expect(() => readWorkerRuntimeConfig({ WORKER_ID: "unsafe\nidentity" })).toThrow("WORKER_ID");
    expect(() =>
      readWorkerRuntimeConfig({
        WORKER_LEASE_DURATION_MS: "1000",
        WORKER_HEARTBEAT_INTERVAL_MS: "1000",
      }),
    ).toThrow("must be less");
  });
});
