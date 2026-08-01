import { describe, expect, it } from "vitest";
import type { CreateExecutionBody } from "@reliability-lab/contracts";
import {
  DurableExecutionWorker,
  ExecutionService,
  hasAmbiguousProviderAttempt,
  InMemoryCircuitBreaker,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
  type ClaimedExecutionJob,
  type DurableAcceptanceInput,
  type DurableAcceptancePort,
  type DurableComparisonAcceptanceInput,
  type DurableJobStore,
  type ReplayCapsuleStore,
} from "../src/index.js";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import { FakeClock, FixedRandom, SequenceIds } from "@reliability-lab/testkit";

const baseBody: CreateExecutionBody = {
  provider: "fake-primary",
  model: "deterministic-v1",
  input: "A deterministic execution fixture",
};

function harness(
  providers?: LlmProvider[],
  capsules?: ReplayCapsuleStore,
  replayRetentionMs?: number,
) {
  const repository = new MemoryExecutionRepository();
  const clock = new FakeClock();
  const replayCapsules = capsules ?? new MemoryReplayCapsuleStore(() => clock.now());
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
    ...(replayRetentionMs === undefined ? {} : { replayRetentionMs }),
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
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "attempt.failed",
      "retry.scheduled",
      "attempt.started",
      "provider.response_received",
      "execution.succeeded",
    ]);
    const failedAttempt = execution.events.find((event) => event.type === "attempt.failed");
    expect(failedAttempt).toMatchObject({
      attemptNumber: 1,
      provider: "fake-primary",
      model: "deterministic-v1",
      latencyMs: 1,
      error: {
        category: "rate_limit",
        code: "fake_rate_limit",
        retryable: true,
      },
    });
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
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "attempt.failed",
      "fallback.selected",
      "attempt.started",
      "provider.response_received",
      "execution.succeeded",
    ]);
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
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "provider.response_received",
      "structured_output.rejected",
      "execution.failed",
    ]);
  });

  it("records successful structured-output validation", async () => {
    const { service } = harness();
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        ...baseBody,
        structuredOutputSchema: {
          type: "object",
          required: ["result"],
          properties: { result: { type: "string" } },
        },
      },
    });
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "provider.response_received",
      "structured_output.validated",
      "execution.succeeded",
    ]);
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
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "attempt.started",
      "attempt.failed",
      "budget.exceeded",
      "execution.failed",
    ]);
    expect(execution.events.find((event) => event.type === "budget.exceeded")).toMatchObject({
      budget: "latency",
      limit: 10,
      observed: 0,
    });
  });

  it("records a circuit rejection before terminal failure", async () => {
    const repository = new MemoryExecutionRepository();
    const service = new ExecutionService({
      repository,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([new DeterministicFakeProvider({ id: "fake-primary" })]),
      circuitBreaker: new InMemoryCircuitBreaker(0),
      ids: new SequenceIds(),
      clock: new FakeClock(),
    });
    const execution = await service.execute({ tenantId: "tenant-a", body: baseBody });
    expect(execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "circuit.rejected",
      "execution.failed",
    ]);
    expect(execution.error).toMatchObject({
      category: "provider_unavailable",
      code: "circuit_open",
    });
  });

  it("normalizes an unexpected continuation error into terminal evidence", async () => {
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async () => {
        throw new Error("unhandled adapter failure");
      },
    };
    const { service, repository } = harness([provider]);
    const execution = await service.execute({ tenantId: "tenant-a", body: baseBody });

    expect(execution).toMatchObject({
      status: "failed",
      error: { code: "execution_internal_failure", retryable: false },
    });
    expect(execution.events.at(-1)?.type).toBe("execution.failed");
    expect(
      (await repository.findById("tenant-a", execution.executionId))?.events.at(-1)?.type,
    ).toBe("execution.failed");
  });

  it("returns a persisted running envelope before provider completion", async () => {
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async (request) => {
        await providerGate;
        return {
          ok: true,
          response: {
            provider: "fake-primary",
            model: request.model,
            outputText: "complete",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const { service, repository } = harness([provider]);
    const submission = await service.submit({
      tenantId: "tenant-a",
      idempotencyKey: "active-key",
      body: baseBody,
    });

    expect(submission.execution.status).toBe("running");
    expect(submission.execution.events.map((event) => event.type)).toEqual(["execution.accepted"]);
    expect((await repository.findById("tenant-a", submission.execution.executionId))?.status).toBe(
      "running",
    );
    const duplicate = await service.submit({
      tenantId: "tenant-a",
      idempotencyKey: "active-key",
      body: baseBody,
    });
    expect(duplicate.execution.executionId).toBe(submission.execution.executionId);
    expect(duplicate.execution.events.map((event) => event.type)).toContain("idempotency.hit");
    expect(await repository.list("tenant-a")).toHaveLength(1);
    releaseProvider();
    await expect(submission.completion).resolves.toMatchObject({ status: "succeeded" });
    await expect(duplicate.completion).resolves.toMatchObject({ status: "succeeded" });
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
      capability: {
        state: "retention_disabled",
        available: false,
        reason: "Live-provider request retention is disabled",
      },
    });
  });

  it("does not call a live provider when required durable retention fails", async () => {
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "live",
      kind: "live",
      execute: async () => {
        providerCalls += 1;
        throw new Error("provider must not be called");
      },
    };
    const unavailable = {
      state: "missing" as const,
      available: false,
      reason: "Replay capsule is unavailable",
    };
    const failingCapsules: ReplayCapsuleStore = {
      put: async () => {
        throw new Error("storage unavailable");
      },
      inspect: async () => unavailable,
      getForReplay: async () => ({ available: false, capability: unavailable }),
      delete: async () => ({ deleted: false, capability: unavailable }),
    };
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: failingCapsules,
      providers: new MapProviderRegistry([liveProvider]),
      allowLivePromptRetention: true,
    });

    const execution = await service.execute({
      tenantId: "tenant-a",
      body: { ...baseBody, provider: "live", replayRetention: "encrypted" },
    });
    expect(execution.status).toBe("failed");
    expect(execution.error?.code).toBe("replay_retention_failed");
    expect(execution.replayable).toBe(false);
    expect(providerCalls).toBe(0);
  });

  it("keeps live retention default-deny even when the deployment permits it", async () => {
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "live",
      kind: "live",
      execute: async (request) => {
        providerCalls += 1;
        return {
          ok: true,
          response: {
            provider: "live",
            model: request.model,
            outputText: "safe result",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([liveProvider]),
      allowLivePromptRetention: true,
    });

    const execution = await service.execute({
      tenantId: "tenant-a",
      body: { ...baseBody, provider: "live" },
    });
    expect(execution).toMatchObject({
      status: "succeeded",
      replayCapability: { state: "retention_disabled", available: false },
    });
    expect(providerCalls).toBe(1);
  });

  it("rejects requested encrypted live retention before the provider when deployment permission is off", async () => {
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "live",
      kind: "live",
      execute: async () => {
        providerCalls += 1;
        throw new Error("provider must not be called");
      },
    };
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([liveProvider]),
    });
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: { ...baseBody, provider: "live", replayRetention: "encrypted" },
    });
    expect(execution).toMatchObject({
      status: "failed",
      error: { code: "live_replay_retention_unavailable" },
    });
    expect(providerCalls).toBe(0);
  });

  it("gives retained live replays a fresh independent capsule before a second provider call", async () => {
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "live",
      kind: "live",
      execute: async (request) => {
        providerCalls += 1;
        return {
          ok: true,
          response: {
            provider: "live",
            model: request.model,
            outputText: "safe result",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const capsules = new MemoryReplayCapsuleStore();
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: capsules,
      providers: new MapProviderRegistry([liveProvider]),
      allowLivePromptRetention: true,
    });
    const original = await service.execute({
      tenantId: "tenant-a",
      body: { ...baseBody, provider: "live", replayRetention: "encrypted" },
    });
    const replay = await service.replay("tenant-a", original.executionId);
    expect(replay.replayable).toBe(true);
    if (!replay.replayable) return;
    expect(replay.replayExecution.executionId).not.toBe(original.executionId);
    expect(replay.replayExecution.replayCapability.state).toBe("available");
    expect((await capsules.inspect("tenant-a", original.executionId)).available).toBe(true);
    expect((await capsules.inspect("tenant-a", replay.replayExecution.executionId)).available).toBe(
      true,
    );
    expect(providerCalls).toBe(2);
  });

  it("enforces tenant scope at the replay capsule boundary", async () => {
    const { service } = harness();
    const original = await service.execute({ tenantId: "tenant-a", body: baseBody });

    await expect(service.replay("tenant-b", original.executionId)).rejects.toThrow(
      "Execution not found",
    );
    await expect(service.deleteReplayCapsule("tenant-b", original.executionId)).rejects.toThrow(
      "Execution not found",
    );
    const ownDetail = await service.get("tenant-a", original.executionId);
    expect(ownDetail.replayCapability.state).toBe("available");
  });

  it("expires replay capability and blocks replay without sleeping", async () => {
    const { service, clock } = harness(undefined, undefined, 1_000);
    const original = await service.execute({ tenantId: "tenant-a", body: baseBody });
    clock.advance(1_001);

    const detail = await service.get("tenant-a", original.executionId);
    expect(detail.replayCapability.state).toBe("expired");
    expect(detail.replayable).toBe(false);
    const replay = await service.replay("tenant-a", original.executionId);
    expect(replay.replayable).toBe(false);
    if (!replay.replayable) expect(replay.capability.state).toBe("expired");
  });

  it("deletes replay data idempotently, audits it, and blocks replay immediately", async () => {
    const clock = new FakeClock();
    const capsules = new MemoryReplayCapsuleStore(() => clock.now());
    const { service } = harness(undefined, capsules);
    const original = await service.execute({ tenantId: "tenant-a", body: baseBody });

    const first = await service.deleteReplayCapsule("tenant-a", original.executionId);
    const second = await service.deleteReplayCapsule("tenant-a", original.executionId);
    expect(first.deleted).toBe(true);
    expect(second.deleted).toBe(false);
    expect(second.capability.state).toBe("deleted");
    expect(
      capsules
        .audits()
        .filter((audit) => audit.operation === "delete")
        .map((audit) => audit.outcome),
    ).toEqual(["deleted", "already_deleted"]);
    const replay = await service.replay("tenant-a", original.executionId);
    expect(replay.replayable).toBe(false);
  });
});

describe("durable execution continuation", () => {
  it("accepts a queued execution without running provider work in the API path", async () => {
    let providerCalls = 0;
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async () => {
        providerCalls += 1;
        throw new Error("provider should not run during acceptance");
      },
    };
    const durable = durableHarness([provider]);
    const submission = await durable.service.submit({ tenantId: "tenant-a", body: baseBody });

    expect(submission.completion).toBeUndefined();
    expect(submission.execution.status).toBe("queued");
    expect(submission.execution.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "execution.queued",
    ]);
    expect(providerCalls).toBe(0);
  });

  it("refuses to rerun a terminal execution", async () => {
    let providerCalls = 0;
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async () => {
        providerCalls += 1;
        throw new Error("terminal execution must not run");
      },
    };
    const durable = durableHarness([provider]);
    const submission = await durable.service.submit({ tenantId: "tenant-a", body: baseBody });
    const stored = await durable.repository.findById("tenant-a", submission.execution.executionId);
    expect(stored).not.toBeNull();
    stored!.status = "succeeded";
    await durable.repository.update(stored!);

    const result = await durable.service.continueAcceptedExecution(
      "tenant-a",
      submission.execution.executionId,
      baseBody,
    );
    expect(result.kind).toBe("already_terminal");
    expect(providerCalls).toBe(0);
  });

  it("classifies prior attempt activity as ambiguous and avoids a duplicate provider call", async () => {
    let providerCalls = 0;
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async () => {
        providerCalls += 1;
        throw new Error("ambiguous attempt must not run");
      },
    };
    const durable = durableHarness([provider]);
    const submission = await durable.service.submit({ tenantId: "tenant-a", body: baseBody });
    const execution = (await durable.repository.findById(
      "tenant-a",
      submission.execution.executionId,
    ))!;
    execution.status = "running";
    execution.attempts.push({
      attemptNumber: 1,
      provider: "fake-primary",
      model: "deterministic-v1",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    execution.events.push({
      schemaVersion: 1,
      eventId: "crash-event",
      executionId: execution.executionId,
      sequence: 3,
      occurredAt: "2026-01-01T00:00:00.000Z",
      type: "attempt.started",
      attemptNumber: 1,
      provider: "fake-primary",
      model: "deterministic-v1",
    });
    await durable.repository.update(execution);

    expect(hasAmbiguousProviderAttempt(execution)).toBe(true);
    const result = await durable.service.continueAcceptedExecution(
      "tenant-a",
      execution.executionId,
      baseBody,
    );
    expect(result.kind).toBe("ambiguous");
    expect(result.execution.error).toMatchObject({
      code: "provider_call_outcome_unknown",
      retryable: false,
    });
    expect(result.execution.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "execution.recovery_detected",
        "attempt.outcome_ambiguous",
        "execution.failed",
      ]),
    );
    expect(providerCalls).toBe(0);
  });

  it("runs an accepted command through the existing engine and deletes it on terminal handling", async () => {
    const durable = durableHarness([
      new DeterministicFakeProvider({ id: "fake-primary", seed: 17 }),
    ]);
    const submission = await durable.service.submit({ tenantId: "tenant-a", body: baseBody });
    const worker = new DurableExecutionWorker({
      jobs: durable.acceptance,
      service: durable.service,
      workerId: "worker-a",
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
    });

    await expect(worker.runOnce()).resolves.toBe(true);
    expect(
      await durable.repository.findById("tenant-a", submission.execution.executionId),
    ).toMatchObject({ status: "succeeded" });
    expect(durable.acceptance.finished).toEqual([expect.objectContaining({ status: "completed" })]);
  });
});

function durableHarness(providers: LlmProvider[]) {
  const repository = new MemoryExecutionRepository();
  const comparisons = new MemoryComparisonExperimentRepository();
  const acceptance = new MemoryDurableAcceptance(repository, comparisons);
  const service = new ExecutionService({
    repository,
    comparisons,
    replayCapsules: new MemoryReplayCapsuleStore(),
    providers: new MapProviderRegistry(providers),
    durableAcceptance: acceptance,
    ids: new SequenceIds(),
    clock: new FakeClock(),
  });
  return { service, repository, acceptance };
}

class MemoryDurableAcceptance implements DurableAcceptancePort, DurableJobStore {
  readonly #repository: MemoryExecutionRepository;
  readonly #comparisons: MemoryComparisonExperimentRepository;
  readonly #jobs: ClaimedExecutionJob[] = [];
  readonly finished: Array<{ status: string }> = [];

  constructor(
    repository: MemoryExecutionRepository,
    comparisons: MemoryComparisonExperimentRepository,
  ) {
    this.#repository = repository;
    this.#comparisons = comparisons;
  }

  async acceptExecution(input: DurableAcceptanceInput) {
    await this.#repository.create(input.execution);
    this.#jobs.push({
      tenantId: input.execution.tenantId,
      executionId: input.execution.executionId,
      workerId: "worker-a",
      claimVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      command: structuredClone(input.command),
      reclaimed: false,
    });
    return input.execution.executionId;
  }

  async acceptComparison(input: DurableComparisonAcceptanceInput) {
    await this.acceptExecution(input);
    await this.#comparisons.create(input.experiment);
    return input.execution.executionId;
  }

  async claimNext(): Promise<ClaimedExecutionJob | null> {
    return this.#jobs.shift() ?? null;
  }

  async heartbeat() {
    return {
      kind: "owned" as const,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async assertOwned() {
    return {
      kind: "owned" as const,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async finish(input: { status: "completed" | "failed" | "ambiguous" }) {
    this.finished.push({ status: input.status });
    return { kind: "finished" as const };
  }
}
