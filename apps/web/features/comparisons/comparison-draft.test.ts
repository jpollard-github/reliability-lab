import { describe, expect, it } from "vitest";
import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import { emptyComparisonDraft, toReplayVariation } from "./comparison-draft.js";
import { applyComparisonPreset } from "./comparison-presets.js";

const execution = {
  policy: { maxAttempts: 2, baseBackoffMs: 100, maxBackoffMs: 1_000, jitterRatio: 0 },
  budget: { maxLatencyMs: 10_000 },
} as ExecutionEnvelope;

describe("Comparative Replay draft", () => {
  it("keeps blank values inherited and supports an explicit no-op check", () => {
    expect(toReplayVariation(emptyComparisonDraft)).toEqual({});
    expect(toReplayVariation(applyComparisonPreset("same", execution))).toEqual({
      reproducibilityCheck: true,
    });
  });

  it("parses numeric form strings and explicit fallback removal", () => {
    expect(
      toReplayVariation({
        ...emptyComparisonDraft,
        maxAttempts: "3",
        jitterRatio: "0.2",
        fallbackProvider: "_remove",
        maxLatencyMs: "5000",
      }),
    ).toEqual({
      policy: { maxAttempts: 3, jitterRatio: 0.2, fallbackProvider: null },
      budget: { maxLatencyMs: 5000 },
    });
  });

  it("preserves the immediate-fallback and patient preset values", () => {
    expect(applyComparisonPreset("fallback", execution)).toMatchObject({
      maxAttempts: "1",
      fallbackProvider: "fake-fallback",
      fallbackModel: "deterministic-v1",
    });
    expect(applyComparisonPreset("patient", execution)).toMatchObject({
      maxAttempts: "3",
      baseBackoffMs: "200",
      maxBackoffMs: "1000",
    });
  });
});
