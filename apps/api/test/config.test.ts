import { describe, expect, it } from "vitest";
import { readReplayRuntimeConfig } from "../src/config.js";

const encodedKey = Buffer.alloc(32, 1).toString("base64");

describe("replay runtime configuration", () => {
  it("defaults to process-local memory with live retention disabled", () => {
    expect(readReplayRuntimeConfig({})).toMatchObject({
      storeMode: "memory",
      allowLivePromptRetention: false,
    });
  });

  it("fails closed when live retention is enabled without the durable store", () => {
    expect(() => readReplayRuntimeConfig({ ALLOW_LIVE_PROMPT_RETENTION: "true" })).toThrow(
      "requires REPLAY_CAPSULE_STORE=postgres",
    );
  });

  it("rejects a PostgreSQL store with missing or invalid key configuration", () => {
    expect(() =>
      readReplayRuntimeConfig({
        REPLAY_CAPSULE_STORE: "postgres",
        DATABASE_URL: "postgresql://local",
      }),
    ).toThrow("REPLAY_CAPSULE_ACTIVE_KEY_VERSION");
    expect(() =>
      readReplayRuntimeConfig({
        REPLAY_CAPSULE_STORE: "postgres",
        DATABASE_URL: "postgresql://local",
        REPLAY_CAPSULE_ACTIVE_KEY_VERSION: "v2",
        REPLAY_CAPSULE_KEYS_JSON: JSON.stringify({ v2: "dG9vLXNob3J0" }),
      }),
    ).toThrow("32 bytes");
  });

  it("accepts read-old/write-current keyrings for PostgreSQL", () => {
    const config = readReplayRuntimeConfig({
      REPLAY_CAPSULE_STORE: "postgres",
      DATABASE_URL: "postgresql://local",
      REPLAY_CAPSULE_ACTIVE_KEY_VERSION: "v2",
      REPLAY_CAPSULE_KEYS_JSON: JSON.stringify({ v1: encodedKey, v2: encodedKey }),
      ALLOW_LIVE_PROMPT_RETENTION: "true",
    });

    expect(config.storeMode).toBe("postgres");
    expect(config.keyring?.activeVersion).toBe("v2");
    expect(config.keyring?.keys.has("v1")).toBe(true);
  });
});
