import { describe, expect, it } from "vitest";
import { DeterministicFakeProvider } from "../src/index.js";

const signal = new AbortController().signal;
const request = {
  executionId: "execution-1",
  tenantId: "tenant-a",
  provider: "fake",
  model: "v1",
  input: "fixture",
  attempt: 1,
} as const;

describe("DeterministicFakeProvider", () => {
  it("produces stable output for the same seed and input", async () => {
    const first = new DeterministicFakeProvider({ id: "fake", seed: 42 });
    const second = new DeterministicFakeProvider({ id: "fake", seed: 42 });
    expect(await first.execute(request, { signal, timeoutMs: 100 })).toEqual(
      await second.execute(request, { signal, timeoutMs: 100 }),
    );
  });

  it.each(["timeout", "rate_limit", "provider_error"] as const)(
    "normalizes the %s failure mode",
    async (failureMode) => {
      const provider = new DeterministicFakeProvider({ id: "fake" });
      const result = await provider.execute(
        { ...request, failureMode },
        { signal, timeoutMs: 100 },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.retryable).toBe(true);
    },
  );

  it("returns deliberately malformed JSON without throwing", async () => {
    const provider = new DeterministicFakeProvider({ id: "fake" });
    const result = await provider.execute(
      { ...request, failureMode: "malformed_json" },
      { signal, timeoutMs: 100 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.outputText).toBe("{this is not json");
    expect(result.response.outputJson).toBeUndefined();
  });
});
