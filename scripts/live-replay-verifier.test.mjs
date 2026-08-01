import { describe, expect, it, vi } from "vitest";
import { runLiveReplayVerifier } from "./live-replay-verifier.mjs";

describe("external encrypted live replay verifier", () => {
  it("exits successfully without calling the proof unless explicitly opted in", async () => {
    const runProof = vi.fn();
    const output = [];
    expect(
      await runLiveReplayVerifier({
        environment: {},
        runProof,
        writeOutput: (message) => output.push(message),
        writeError: vi.fn(),
      }),
    ).toBe(0);
    expect(runProof).not.toHaveBeenCalled();
    expect(output.join("")).toContain("not run");
  });

  it("prints only bounded metadata for an exact successful two-call proof", async () => {
    const output = [];
    const environment = {
      RUN_LIVE_REPLAY_VERIFY: "true",
      OPENAI_COMPATIBLE_BASE_URL: "https://provider.example/v1",
      OPENAI_API_KEY: "secret-provider-key",
      OPENAI_MODEL: "safe-model",
      DATABASE_URL: "postgresql://secret-database",
      REPLAY_CAPSULE_STORE: "postgres",
      ALLOW_LIVE_PROMPT_RETENTION: "true",
      REPLAY_CAPSULE_ACTIVE_KEY_VERSION: "v1",
      REPLAY_CAPSULE_KEYS_JSON: '{"v1":"secret-replay-key"}',
    };
    const status = await runLiveReplayVerifier({
      environment,
      runProof: async () => ({
        providerId: "openai-compatible",
        modelLabel: "safe-model",
        originalExecutionId: "execution-1",
        replayExecutionId: "execution-2",
        originalStatus: "succeeded",
        replayStatus: "succeeded",
        externalRequestCount: 2,
        originalLatencyMs: 10,
        replayLatencyMs: 11,
      }),
      writeOutput: (message) => output.push(message),
      writeError: vi.fn(),
    });
    const text = output.join("");
    expect(status).toBe(0);
    expect(text).toContain("externalRequestCount=2");
    expect(text).not.toMatch(/secret|provider\.example|postgresql|capsule.*content/i);
  });
});
