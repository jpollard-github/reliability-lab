import { describe, expect, it } from "vitest";
import type { CreateExecutionBody } from "@reliability-lab/contracts";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
  type ReplayCapsuleStore,
} from "../src/index.js";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import { FakeClock, FixedRandom, SequenceIds } from "@reliability-lab/testkit";

const baseBody: CreateExecutionBody = {
  provider: "fake-primary",
  model: "deterministic-v1",
  input: "A deterministic incident fixture",
};

function harness(providers?: LlmProvider[], capsules?: ReplayCapsuleStore) {
  const repository = new MemoryExecutionRepository();
  const replayCapsules = capsules ?? new MemoryReplayCapsuleStore();
  const clock = new FakeClock();
  const service = new ExecutionService({
    repository,
    replayCapsules,
    providers: new MapProviderRegistry(
      providers ?? [
        new DeterministicFakeProvider({ id: "fake-primary", seed: 17 }),
        new DeterministicFakeProvider({ id: "fake-fallback", seed: 29 }),
      ],
    ),
    clock,
    random: new FixedRandom(),
    ids: new SequenceIds(),
  });
  return { service, repository, replayCapsules, clock };
}

describe("ExecutionService policy", () => {
  it("succeeds through the primary provider", async () => {
    const { service } = harness();
    const execution = await service.execute({ tenantId: "tenant-a", body: baseBody });
    expect(execution.status).toBe("succeeded");
    expect(execution.attempts).toHaveLength(1);
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "provider.response_received",
      "execution.succeeded",
    ]);
  });

  it("retries a rate limit with deterministic bounded backoff", async () => {
    const { service, clock } = harness();
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        ...baseBody,
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 20, maxBackoffMs: 20, jitterRatio: 0 },
      },
    });
    expect(execution.status).toBe("succeeded");
    expect(execution.attempts).toHaveLength(2);
    expect(clock.sleeps).toEqual([20]);
    expect(execution.events.some((event) => event.type === "retry.scheduled")).toBe(true);
  });

  it("falls back after primary failure and marks the execution degraded", async () => {
    const { service } = harness();
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        ...baseBody,
        failureMode: "provider_error",
        policy: {
          maxAttempts: 1,
          fallbackProvider: "fake-fallback",
          fallbackModel: "fallback-v1",
        },
      },
    });
    expect(execution.status).toBe("degraded");
    expect(execution.provider).toBe("fake-fallback");
    expect(execution.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
    expect(execution.events.some((event) => event.type === "fallback.selected")).toBe(true);
  });

  it("rejects malformed structured output against JSON Schema", async () => {
    const { service } = harness();
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        ...baseBody,
        failureMode: "malformed_json",
        structuredOutputSchema: {
          type: "object",
          required: ["result"],
          properties: { result: { type: "string" } },
        },
      },
    });
    expect(execution.status).toBe("failed");
    expect(execution.error?.category).toBe("malformed_response");
    expect(execution.events.some((event) => event.type === "structured_output.rejected")).toBe(
      true,
    );
  });

  it("rejects retry when it would exceed the latency budget", async () => {
    const { service } = harness();
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        ...baseBody,
        failureMode: "latency",
        budget: { maxLatencyMs: 10 },
        policy: { maxAttempts: 2, baseBackoffMs: 50, maxBackoffMs: 50, jitterRatio: 0 },
      },
    });
    expect(execution.status).toBe("failed");
    expect(execution.error?.category).toBe("budget_exceeded");
    expect(execution.events.some((event) => event.type === "budget.exceeded")).toBe(true);
  });

  it("returns the original execution for an idempotent duplicate", async () => {
    const { service, repository } = harness();
    const first = await service.execute({
      tenantId: "tenant-a",
      idempotencyKey: "same-key",
      body: baseBody,
    });
    const second = await service.execute({
      tenantId: "tenant-a",
      idempotencyKey: "same-key",
      body: baseBody,
    });
    expect(second.executionId).toBe(first.executionId);
    expect(await repository.list("tenant-a")).toHaveLength(1);
    expect(second.events.at(-1)?.type).toBe("idempotency.hit");
  });

  it("preserves event sequence and schema version", async () => {
    const { service } = harness();
    const execution = await service.execute({ tenantId: "tenant-a", body: baseBody });
    expect(execution.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(execution.events.every((event) => event.schemaVersion === 1)).toBe(true);
  });
});

describe("ExecutionService replay", () => {
  it("creates a linked execution and compares deterministic outcomes", async () => {
    const { service, repository } = harness();
    const original = await service.execute({ tenantId: "tenant-a", body: baseBody });
    const result = await service.replay("tenant-a", original.executionId);
    expect(result.replayable).toBe(true);
    if (!result.replayable) return;
    expect(result.replayExecution.replayOfExecutionId).toBe(original.executionId);
    expect(result.outcomeMatches).toBe(true);
    expect(await repository.list("tenant-a")).toHaveLength(2);
    expect(result.replayExecution.events.at(-1)?.type).toBe("replay.completed");
  });

  it("returns an explainable non-replayable result for live providers with retention off", async () => {
    const liveProvider: LlmProvider = {
      id: "live",
      kind: "live",
      execute: async (request) => ({
        ok: true,
        response: {
          provider: "live",
          model: request.model,
          outputText: "safe result",
          usage: { inputTokens: 1, outputTokens: 1 },
          latencyMs: 1,
        },
      }),
    };
    const { service } = harness([liveProvider]);
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { ...baseBody, provider: "live" },
    });
    const result = await service.replay("tenant-a", original.executionId);
    expect(result).toEqual({
      replayable: false,
      originalExecutionId: original.executionId,
      reason: "Live-provider request retention is disabled",
    });
  });
});
