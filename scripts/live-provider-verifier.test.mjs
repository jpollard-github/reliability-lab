import { describe, expect, it, vi } from "vitest";
import { runLiveProviderVerifier } from "./live-provider-verifier.mjs";

const configuredEnvironment = {
  RUN_LIVE_PROVIDER_VERIFY: "true",
  OPENAI_COMPATIBLE_BASE_URL: "https://provider.example/v1",
  OPENAI_API_KEY: "test-secret-key",
  OPENAI_MODEL: "test-model",
};
const succeededResult = {
  providerId: "openai-compatible",
  modelLabel: "test-model",
  status: "succeeded",
  totalLatencyMs: 125,
  providerLatencyMs: 100,
  inputTokens: 8,
  outputTokens: 4,
  totalTokens: 12,
  externalRequestCount: 1,
};

describe("runLiveProviderVerifier", () => {
  it("returns an explicit not-run result without invoking the provider proof", async () => {
    const runProof = vi.fn();
    const result = await runVerifier({
      environment: {},
      runProof,
    });

    expect(result.code).toBe(0);
    expect(result.output).toMatch(/not run.+no request was made/iu);
    expect(runProof).not.toHaveBeenCalled();
  });

  it("fails without a request and names only missing settings", async () => {
    const runProof = vi.fn();
    const result = await runVerifier({
      environment: {
        RUN_LIVE_PROVIDER_VERIFY: "true",
        OPENAI_API_KEY: "do-not-print-this-key",
      },
      runProof,
    });

    expect(result.code).toBe(1);
    expect(result.error).toContain("OPENAI_COMPATIBLE_BASE_URL");
    expect(result.error).toContain("OPENAI_MODEL");
    expect(result.error).not.toContain("do-not-print-this-key");
    expect(runProof).not.toHaveBeenCalled();
  });

  it("accepts only a normalized succeeded execution and reports bounded metadata", async () => {
    const result = await runVerifier({
      environment: configuredEnvironment,
      runProof: vi.fn().mockResolvedValue(succeededResult),
    });

    expect(result.code).toBe(0);
    expect(result.output).toContain("External live provider proof: succeeded");
    expect(result.output).toContain("providerId=openai-compatible");
    expect(result.output).toContain("model=test-model");
    expect(result.output).toContain("status=succeeded");
    expect(result.output).toContain("totalLatencyMs=125");
    expect(result.output).toContain("providerLatencyMs=100");
    expect(result.output).toContain("inputTokens=8");
    expect(result.output).toContain("outputTokens=4");
    expect(result.output).toContain("totalTokens=12");
    expect(result.output).toContain("externalRequestCount=1");
  });

  it.each(["failed", "rejected", "timed_out", "cancelled", "degraded"])(
    "fails for the non-success terminal status %s",
    async (status) => {
      const result = await runVerifier({
        environment: configuredEnvironment,
        runProof: vi.fn().mockResolvedValue({ ...succeededResult, status }),
      });

      expect(result.code).toBe(1);
      expect(result.output).not.toMatch(/passed|succeeded/iu);
      expect(result.error).toContain("failed safely");
    },
  );

  it("fails when waiting for terminal state times out", async () => {
    const result = await runVerifier({
      environment: configuredEnvironment,
      runProof: vi.fn().mockRejectedValue(new Error("terminal wait timed out")),
    });

    expect(result.code).toBe(1);
    expect(result.output).not.toMatch(/passed|succeeded/iu);
  });

  it.each([
    null,
    {},
    { ...succeededResult, providerId: undefined },
    { ...succeededResult, modelLabel: undefined },
    { ...succeededResult, externalRequestCount: 2 },
    { ...succeededResult, inputTokens: "8" },
  ])("fails for a malformed terminal result", async (proofResult) => {
    const result = await runVerifier({
      environment: configuredEnvironment,
      runProof: vi.fn().mockResolvedValue(proofResult),
    });

    expect(result.code).toBe(1);
    expect(result.output).not.toMatch(/passed|succeeded/iu);
  });

  it("redacts configuration, request, response, and unexpected result fields", async () => {
    const result = await runVerifier({
      environment: configuredEnvironment,
      runProof: vi.fn().mockResolvedValue({
        ...succeededResult,
        input: "private prompt",
        outputText: "private output",
        apiKey: "result-secret-key",
        baseUrl: "https://private.example/v1",
        authorization: "Bearer private",
      }),
    });
    const combined = result.output + result.error;

    expect(result.code).toBe(0);
    expect(combined).not.toContain(configuredEnvironment.OPENAI_API_KEY);
    expect(combined).not.toContain(configuredEnvironment.OPENAI_COMPATIBLE_BASE_URL);
    expect(combined).not.toContain("private prompt");
    expect(combined).not.toContain("private output");
    expect(combined).not.toContain("result-secret-key");
    expect(combined).not.toContain("Bearer private");
  });
});

async function runVerifier({ environment, runProof }) {
  let output = "";
  let error = "";
  const code = await runLiveProviderVerifier({
    environment,
    runProof,
    writeOutput: (message) => (output += message),
    writeError: (message) => (error += message),
  });
  return { code, output, error };
}
