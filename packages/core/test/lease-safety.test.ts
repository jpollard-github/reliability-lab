import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmProvider } from "@reliability-lab/providers";
import {
  abortableSleep,
  DurableExecutionWorker,
  ExecutionService,
  isLeaseOwnershipLostError,
  LeaseHeartbeatController,
  LeaseOwnershipLostError,
  MapProviderRegistry,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
  type ClaimedExecutionJob,
  type Clock,
  type DurableAcceptanceInput,
  type DurableAcceptancePort,
  type DurableComparisonAcceptanceInput,
  type DurableJobStore,
  type JobClaim,
} from "../src/index.js";

const startMs = Date.parse("2026-07-28T12:00:00.000Z");
const claim: JobClaim = {
  tenantId: "tenant-a",
  executionId: "execution-a",
  workerId: "worker-a",
  claimVersion: 7,
  leaseExpiresAt: new Date(startMs + 1_000).toISOString(),
};

describe("lease heartbeat safety", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(startMs);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serializes heartbeat calls and carries the claim version", async () => {
    const firstHeartbeat = deferred<void>();
    const seenVersions: number[] = [];
    let calls = 0;
    let active = 0;
    let maximumActive = 0;
    const jobs = jobStore({
      heartbeat: async ({ claim: observedClaim }) => {
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        seenVersions.push(observedClaim.claimVersion);
        if (calls === 1) await firstHeartbeat.promise;
        active -= 1;
        return {
          kind: "owned",
          leaseExpiresAt: new Date(Date.now() + 1_000).toISOString(),
        };
      },
    });
    const controller = heartbeatController(jobs);
    controller.start();

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls).toBe(1);
    expect(maximumActive).toBe(1);

    firstHeartbeat.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    expect(maximumActive).toBe(1);
    expect(seenVersions).toEqual([7, 7]);
    await controller.stop();
  });

  it("contains heartbeat rejection and retries only before the confirmed deadline", async () => {
    let calls = 0;
    const jobs = jobStore({
      heartbeat: async () => {
        calls += 1;
        throw new Error("database temporarily unavailable");
      },
    });
    const controller = heartbeatController(jobs);
    controller.start();

    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toBe(2);
    expect(controller.signal.aborted).toBe(false);
    await controller.stop();
  });

  it("aborts continuation immediately when a heartbeat reports ownership loss", async () => {
    const jobs = jobStore({
      heartbeat: async () => ({ kind: "ownership_lost" }),
    });
    const controller = heartbeatController(jobs);
    controller.start();

    await vi.advanceTimersByTimeAsync(100);
    expect(controller.signal.aborted).toBe(true);
    await expect(controller.assertActive()).rejects.toSatisfy(isLeaseOwnershipLostError);
    await controller.stop();
  });

  it("aborts at the confirmed lease deadline when renewal cannot be observed", async () => {
    const shortClaim = {
      ...claim,
      leaseExpiresAt: new Date(startMs + 250).toISOString(),
    };
    const jobs = jobStore({
      heartbeat: async () => {
        throw new Error("database unavailable through deadline");
      },
    });
    const controller = new LeaseHeartbeatController({
      jobs,
      claim: shortClaim,
      leaseDurationMs: 250,
      heartbeatIntervalMs: 100,
    });
    controller.start();

    await vi.advanceTimersByTimeAsync(250);
    expect(controller.signal.aborted).toBe(true);
    await expect(controller.assertActive()).rejects.toBeInstanceOf(LeaseOwnershipLostError);
    await controller.stop();
  });
});

describe("lease-aware continuation", () => {
  it("makes retry sleep abortable without turning lease loss into a timeout", async () => {
    const pendingSleep = deferred<void>();
    const clock: Clock = {
      now: () => new Date(),
      sleep: async () => pendingSleep.promise,
    };
    const controller = new AbortController();
    const sleeping = abortableSleep(clock, 1_000, controller.signal);
    controller.abort(new LeaseOwnershipLostError());

    await expect(sleeping).rejects.toBeInstanceOf(LeaseOwnershipLostError);
  });

  it("records a latency abort as execution evidence", async () => {
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async (_request, options) =>
        new Promise((resolve) => {
          options.signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: {
                  category: "timeout",
                  code: "provider_timeout",
                  message: "Latency budget expired",
                  retryable: false,
                },
                latencyMs: 5,
              }),
            { once: true },
          );
        }),
    };
    const service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([provider]),
    });

    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "timeout",
        policy: { maxAttempts: 1 },
        budget: { maxLatencyMs: 5 },
      },
    });

    expect(execution).toMatchObject({
      status: "failed",
      error: { category: "timeout", code: "provider_timeout" },
    });
    expect(execution.events.map((event) => event.type)).toContain("attempt.failed");
  });

  it("checks ownership after provider return and leaves terminal handling to the new owner", async () => {
    const providerStarted = deferred<void>();
    const providerRelease = deferred<void>();
    let providerCalls = 0;
    const provider: LlmProvider = {
      id: "fake-primary",
      kind: "fake",
      execute: async (request) => {
        providerCalls += 1;
        providerStarted.resolve();
        await providerRelease.promise;
        return {
          ok: true,
          response: {
            provider: "fake-primary",
            model: request.model,
            outputText: "must be fenced",
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            latencyMs: 1,
          },
        };
      },
    };
    const repository = new MemoryExecutionRepository();
    const jobs = new ControlledDurableStore(repository);
    const service = new ExecutionService({
      repository,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([provider]),
      durableAcceptance: jobs,
    });
    const accepted = await service.submit({
      tenantId: "tenant-a",
      body: { provider: "fake-primary", model: "v1", input: "split brain" },
    });
    const worker = new DurableExecutionWorker({
      jobs,
      service,
      workerId: "worker-a",
      leaseDurationMs: 60_000,
      heartbeatIntervalMs: 10_000,
    });

    const running = worker.runOnce();
    await providerStarted.promise;
    jobs.owned = false;
    providerRelease.resolve();
    await expect(running).resolves.toBe(true);

    const execution = await repository.findById("tenant-a", accepted.execution.executionId);
    expect(providerCalls).toBe(1);
    expect(jobs.finishCalls).toBe(0);
    expect(execution).toMatchObject({ status: "running" });
    expect(execution?.events.map((event) => event.type)).not.toContain(
      "provider.response_received",
    );
    expect(execution?.events.map((event) => event.type)).not.toContain("execution.failed");
    expect(execution?.events.map((event) => event.type)).not.toContain("execution.succeeded");
  });
});

function heartbeatController(jobs: DurableJobStore) {
  return new LeaseHeartbeatController({
    jobs,
    claim,
    leaseDurationMs: 1_000,
    heartbeatIntervalMs: 100,
  });
}

function jobStore(overrides: Partial<DurableJobStore> = {}): DurableJobStore {
  return {
    claimNext: async () => null,
    heartbeat: async () => ({
      kind: "owned",
      leaseExpiresAt: new Date(Date.now() + 1_000).toISOString(),
    }),
    assertOwned: async () => ({
      kind: "owned",
      leaseExpiresAt: new Date(Date.now() + 1_000).toISOString(),
    }),
    finish: async () => ({ kind: "finished" }),
    ...overrides,
  };
}

class ControlledDurableStore implements DurableAcceptancePort, DurableJobStore {
  readonly #repository: MemoryExecutionRepository;
  #job: ClaimedExecutionJob | undefined;
  owned = true;
  finishCalls = 0;

  constructor(repository: MemoryExecutionRepository) {
    this.#repository = repository;
  }

  async acceptExecution(input: DurableAcceptanceInput) {
    await this.#repository.create(input.execution);
    this.#job = {
      tenantId: input.execution.tenantId,
      executionId: input.execution.executionId,
      workerId: "worker-a",
      claimVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      command: structuredClone(input.command),
      reclaimed: false,
    };
    return input.execution.executionId;
  }

  async acceptComparison(input: DurableComparisonAcceptanceInput) {
    return this.acceptExecution(input);
  }

  async claimNext() {
    const job = this.#job;
    this.#job = undefined;
    return job ?? null;
  }

  async heartbeat() {
    return this.#ownershipOutcome();
  }

  async assertOwned() {
    return this.#ownershipOutcome();
  }

  async finish() {
    this.finishCalls += 1;
    return this.owned ? ({ kind: "finished" } as const) : ({ kind: "ownership_lost" } as const);
  }

  #ownershipOutcome() {
    return this.owned
      ? ({
          kind: "owned",
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        } as const)
      : ({ kind: "ownership_lost" } as const);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
