import { describe, expect, it } from "vitest";
import { validateLiveProviderRequest } from "../src/execution/live-provider-request.js";

const capability = {
  id: "openai-compatible",
  kind: "live",
  modelLabel: "server-model",
  transportFamily: "openai_compatible_chat_completions",
  configured: true,
  supportsFailureInjection: false,
  operatorEligible: true,
} as const;
const base = {
  body: {
    provider: "openai-compatible",
    model: "server-model",
    input: "bounded input",
  },
  policy: {
    maxAttempts: 1,
    baseBackoffMs: 0,
    maxBackoffMs: 0,
    jitterRatio: 0,
  },
  budget: { maxLatencyMs: 20_000 },
  capability,
};

describe("validateLiveProviderRequest", () => {
  it("accepts the bounded server-configured operator request", () => {
    expect(validateLiveProviderRequest(base)).toBeNull();
  });

  it.each([
    { body: { ...base.body, model: "other-model" } },
    { body: { ...base.body, failureMode: "rate_limit" as const } },
    { body: { ...base.body, input: "x".repeat(4_001) } },
    {
      body: {
        provider: "openai-compatible",
        model: "server-model",
        messages: Array.from({ length: 9 }, () => ({ role: "user" as const, content: "x" })),
      },
    },
    {
      body: {
        ...base.body,
        structuredOutputSchema: { value: "x".repeat(16_001) },
      },
    },
    { policy: { ...base.policy, maxAttempts: 3 } },
    { policy: { ...base.policy, maxBackoffMs: 5_001 } },
    { budget: { maxLatencyMs: 30_001 } },
    { budget: { maxLatencyMs: 20_000, maxCostUsd: 1.01 } },
  ])("rejects live request values outside server bounds", (change) => {
    expect(validateLiveProviderRequest({ ...base, ...change })).toMatchObject({
      category: "invalid_request",
      retryable: false,
    });
  });
});
