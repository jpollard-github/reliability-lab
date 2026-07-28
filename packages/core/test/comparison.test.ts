import { describe, expect, it } from "vitest";
import {
  ExecutionService,
  InvalidComparisonVariationError,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
  projectComparison,
  resolveReplayVariation,
} from "../src/index.js";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import { FakeClock, FixedRandom, SequenceIds } from "@reliability-lab/testkit";

function harness() {
  const clock = new FakeClock();
  const comparisons = new MemoryComparisonExperimentRepository();
  const service = new ExecutionService({
    repository: new MemoryExecutionRepository(),
    comparisons,
    replayCapsules: new MemoryReplayCapsuleStore(() => clock.now()),
    providers: new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary", seed: 17 }),
      new DeterministicFakeProvider({ id: "fake-fallback", seed: 29 }),
    ]),
    clock,
    random: new FixedRandom(),
    ids: new SequenceIds(),
  });
  return { service, comparisons };
}

describe("comparative replay", () => {
  it("submits a linked variant through the normal execution path and projects evidence", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "deterministic-v1",
        input: "retained but never returned",
        failureMode: "rate_limit",
        policy: {
          maxAttempts: 2,
          baseBackoffMs: 20,
          maxBackoffMs: 20,
          jitterRatio: 0,
        },
      },
    });

    const submission = await service.createComparison("tenant-a", original.executionId, {
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    });
    expect(submission.experiment).toMatchObject({
      schemaVersion: 1,
      status: "running",
      originalExecutionId: original.executionId,
      variantExecutionId: "execution-2",
      resolvedVariant: {
        provider: "fake-primary",
        model: "deterministic-v1",
        policy: { maxAttempts: 1, fallbackProvider: "fake-fallback" },
      },
    });
    expect(JSON.stringify(submission.experiment)).not.toContain("retained but never returned");
    await submission.completion;

    const view = await service.getComparison("tenant-a", submission.experiment.experimentId);
    expect(view.experiment.status).toBe("completed");
    expect(view.variantExecution).toMatchObject({
      replayOfExecutionId: original.executionId,
      status: "degraded",
    });
    expect(view.variantExecution?.events.map((event) => event.type)).toContain("fallback.selected");
    expect(view.projection.dimensions.find((item) => item.key === "retries")).toMatchObject({
      original: 1,
      variant: 0,
      change: "improved",
    });
    expect(view.projection.summary).toContain("no universal winner");
  });

  it("requires an explicit reproducibility check for unchanged conditions", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { provider: "fake-primary", model: "v1", input: "same" },
    });
    await expect(
      service.createComparison("tenant-a", original.executionId, {}),
    ).rejects.toBeInstanceOf(InvalidComparisonVariationError);
    const allowed = await service.createComparison("tenant-a", original.executionId, {
      reproducibilityCheck: true,
    });
    await expect(allowed.completion).resolves.toMatchObject({ status: "succeeded" });
  });

  it("persists an unavailable experiment without creating a variant", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { provider: "fake-primary", model: "v1", input: "delete me" },
    });
    await service.deleteReplayCapsule("tenant-a", original.executionId);
    const submission = await service.createComparison("tenant-a", original.executionId, {
      policy: { maxAttempts: 1 },
    });
    expect(submission.experiment).toMatchObject({
      status: "unavailable",
      unavailableReason: "Replay capsule was deleted",
    });
    expect(submission.variantExecution).toBeUndefined();
    expect(
      (await service.getComparison("tenant-a", submission.experiment.experimentId)).projection
        .summary,
    ).toContain("unavailable");
    await expect(
      service.getComparison("tenant-b", submission.experiment.experimentId),
    ).rejects.toThrow("Comparison experiment not found");
  });

  it("preserves the retention-disabled capability reason", async () => {
    const liveProvider: LlmProvider = {
      id: "live-provider",
      kind: "live",
      execute: async (request) => ({
        ok: true,
        response: {
          provider: "live-provider",
          model: request.model,
          outputText: "live result",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
      }),
    };
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([liveProvider]),
    });
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { provider: "live-provider", model: "v1", input: "not retained" },
    });
    const submission = await service.createComparison("tenant-a", original.executionId, {
      policy: { maxAttempts: 1 },
    });
    expect(submission.experiment).toMatchObject({
      status: "unavailable",
      unavailableReason: "Live-provider request retention is disabled",
    });
  });

  it("treats missing usage and cost as unavailable rather than zero", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { provider: "fake-primary", model: "v1", input: "evidence" },
    });
    const variant = structuredClone(original);
    variant.executionId = "variant";
    delete variant.attempts[0]!.usage;
    const projection = projectComparison(original, variant);
    expect(projection.dimensions.find((item) => item.key === "input_tokens")?.change).toBe(
      "unavailable",
    );
    expect(projection.dimensions.find((item) => item.key === "cost")).toMatchObject({
      original: 0,
      variant: null,
      change: "unavailable",
    });
  });

  it("treats token differences as factual rather than automatically improved", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { provider: "fake-primary", model: "v1", input: "a longer retained input" },
    });
    const variant = structuredClone(original);
    variant.executionId = "variant";
    variant.attempts[0]!.usage = {
      ...variant.attempts[0]!.usage!,
      inputTokens: Math.max(1, variant.attempts[0]!.usage!.inputTokens - 1),
      outputTokens: Math.max(1, variant.attempts[0]!.usage!.outputTokens - 1),
    };
    const projection = projectComparison(original, variant);
    expect(projection.dimensions.find((item) => item.key === "input_tokens")).toMatchObject({
      change: "mixed",
    });
    expect(projection.dimensions.find((item) => item.key === "output_tokens")).toMatchObject({
      change: "mixed",
    });
  });

  it("supports explicit fallback removal and validates configured providers", async () => {
    const { service } = harness();
    const original = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "fallback",
        policy: { fallbackProvider: "fake-fallback", fallbackModel: "fallback-v1" },
      },
    });
    const resolved = resolveReplayVariation({
      original,
      variation: { policy: { fallbackProvider: null } },
      structuredOutputRequired: false,
      providerAvailable: (provider) => ["fake-primary", "fake-fallback"].includes(provider),
    });
    expect(resolved.policy.fallbackProvider).toBeUndefined();
    await expect(
      service.createComparison("tenant-a", original.executionId, {
        provider: "not-configured",
      }),
    ).rejects.toThrow("not configured");
  });
});
