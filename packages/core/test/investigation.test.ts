import { describe, expect, it } from "vitest";
import type { ExecutionEnvelope, ExecutionEvent } from "@reliability-lab/contracts";
import {
  decodeExecutionCursor,
  encodeExecutionCursor,
  InvestigationQueryError,
  MemoryExecutionRepository,
  MemoryInvestigationReadRepository,
  observeProviders,
  resolveInvestigationRange,
  summarizeReliability,
} from "../src/index.js";

const RANGE = {
  from: "2026-01-01T00:00:00.000Z",
  to: "2026-01-02T00:00:00.000Z",
};

describe("investigation projections", () => {
  it("uses only terminal executions as the outcome-rate denominator", () => {
    const summary = summarizeReliability(
      [
        fixture({ executionId: "success", status: "succeeded", durationMs: 10 }),
        fixture({ executionId: "degraded", status: "degraded", durationMs: 20 }),
        fixture({ executionId: "failed", status: "failed", durationMs: 100 }),
        fixture({ executionId: "queued", status: "queued" }),
        fixture({ executionId: "running", status: "running" }),
        fixture({ executionId: "cancelled", status: "cancelled" }),
      ],
      RANGE,
    );
    expect(summary.population).toMatchObject({ total: 6, terminal: 4, cancelled: 1 });
    expect(summary.outcomes).toMatchObject({
      successRate: 1 / 4,
      degradedRate: 1 / 4,
      failureRate: 1 / 4,
    });
    expect(summary.latency).toEqual({ sampleSize: 4, p50Ms: 10, p95Ms: 100 });
  });

  it("tracks usage coverage and provider terminal-attempt denominators", () => {
    const withUsage = fixture({ executionId: "with-usage" });
    const missingUsage = fixture({
      executionId: "missing-usage",
      attempts: [
        {
          attemptNumber: 1,
          provider: "fake-primary",
          model: "deterministic-v1",
          status: "running",
          startedAt: "2026-01-01T12:00:00.000Z",
        },
      ],
    });
    const summary = summarizeReliability([withUsage, missingUsage], RANGE);
    expect(summary.usage).toMatchObject({
      executionCoverage: 1,
      costCoverage: 1,
      inputTokens: 2,
      outputTokens: 3,
      estimatedCostUsd: 0.001,
    });
    expect(observeProviders([withUsage, missingUsage])[0]).toMatchObject({
      attemptCount: 2,
      terminalAttemptCount: 1,
      succeededAttempts: 1,
      runningAttempts: 1,
      observedSuccessRate: 1,
      sampleAssessment: "insufficient_sample",
    });
  });

  it("names generic provider-unavailable evidence without implying capacity", () => {
    const unavailable = fixture({
      status: "failed",
      attempts: [
        {
          attemptNumber: 1,
          provider: "fake-primary",
          model: "deterministic-v1",
          status: "failed",
          startedAt: "2026-01-01T12:00:00.000Z",
          completedAt: "2026-01-01T12:00:00.010Z",
          durationMs: 10,
          error: {
            category: "provider_unavailable",
            code: "upstream_503",
            message: "Provider returned 503",
            retryable: true,
          },
        },
      ],
    });
    const summary = summarizeReliability([unavailable], RANGE);
    expect(summary.signals.providerUnavailableFailures).toBe(1);
    expect(JSON.stringify(summary.signals)).not.toContain("Capacity");
  });

  it("returns null rates and percentiles when no terminal evidence exists", () => {
    const summary = summarizeReliability([fixture({ status: "queued" })], RANGE);
    expect(summary.outcomes.successRate).toBeNull();
    expect(summary.outcomes.degradedRate).toBeNull();
    expect(summary.outcomes.failureRate).toBeNull();
    expect(summary.latency).toEqual({ sampleSize: 0, p50Ms: null, p95Ms: null });
  });

  it("derives retry and fallback signals from persisted events", async () => {
    const repository = new MemoryExecutionRepository();
    await repository.create(
      fixture({
        executionId: "execution-signals",
        status: "degraded",
        events: [event("retry.scheduled", 1), event("fallback.selected", 2)],
      }),
    );
    const investigations = new MemoryInvestigationReadRepository(repository);
    const page = await investigations.searchExecutions("tenant-a", { range: RANGE, limit: 25 });
    expect(page.data[0]?.signals).toEqual(["retry_recovered", "fallback_used"]);
  });

  it("applies tenant scope, route filters, and stable opaque cursors", async () => {
    const repository = new MemoryExecutionRepository();
    await repository.create(
      fixture({
        executionId: "execution-b",
        createdAt: "2026-01-01T12:00:00.000Z",
        traceId: "trace-b",
      }),
    );
    await repository.create(
      fixture({
        executionId: "execution-a",
        createdAt: "2026-01-01T12:00:00.000Z",
        traceId: "trace-a",
      }),
    );
    await repository.create(
      fixture({
        executionId: "other-tenant",
        tenantId: "tenant-b",
        createdAt: "2026-01-01T13:00:00.000Z",
      }),
    );
    const investigations = new MemoryInvestigationReadRepository(repository);
    const first = await investigations.searchExecutions("tenant-a", {
      range: RANGE,
      limit: 1,
      providers: ["fake-primary"],
    });
    expect(first.data.map((item) => item.executionId)).toEqual(["execution-b"]);
    expect(first.total).toBe(2);
    expect(first.nextCursor).toBeDefined();
    expect(first.nextCursor).not.toContain("execution-b");
    expect(decodeExecutionCursor(first.nextCursor!)).toEqual({
      createdAt: "2026-01-01T12:00:00.000Z",
      executionId: "execution-b",
    });
    const second = await investigations.searchExecutions("tenant-a", {
      range: RANGE,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.data.map((item) => item.executionId)).toEqual(["execution-a"]);
    const terminal = await investigations.searchExecutions("tenant-a", {
      range: RANGE,
      limit: 1,
      cursor: encodeExecutionCursor(second.data[0]!.createdAt, second.data[0]!.executionId),
    });
    expect(terminal).toMatchObject({ data: [], total: 2 });
  });

  it("rejects malformed, inverted, and over-wide ranges", () => {
    expect(() => resolveInvestigationRange({ from: "not-a-date", to: RANGE.to })).toThrow(
      InvestigationQueryError,
    );
    expect(() => resolveInvestigationRange({ from: RANGE.to, to: RANGE.from })).toThrow(/earlier/);
    expect(() =>
      resolveInvestigationRange({
        from: "2025-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow(/90 days/);
  });
});

function fixture(overrides: Partial<ExecutionEnvelope> = {}): ExecutionEnvelope {
  return {
    schemaVersion: 1,
    executionId: "execution-1",
    tenantId: "tenant-a",
    status: "succeeded",
    provider: "fake-primary",
    model: "deterministic-v1",
    traceId: "trace-1",
    requestHash: "request-hash",
    policy: {
      maxAttempts: 2,
      baseBackoffMs: 0,
      maxBackoffMs: 0,
      jitterRatio: 0,
    },
    budget: { maxLatencyMs: 1_000 },
    attempts: [
      {
        attemptNumber: 1,
        provider: "fake-primary",
        model: "deterministic-v1",
        status: "succeeded",
        startedAt: "2026-01-01T12:00:00.000Z",
        completedAt: "2026-01-01T12:00:00.010Z",
        durationMs: 10,
        usage: { inputTokens: 2, outputTokens: 3, estimatedCostUsd: 0.001 },
      },
    ],
    events: [],
    createdAt: "2026-01-01T12:00:00.000Z",
    updatedAt: "2026-01-01T12:00:00.010Z",
    durationMs: 10,
    replayCapability: {
      state: "available",
      available: true,
      reason: "Fixture replay capsule",
    },
    replayable: true,
    ...overrides,
  };
}

function event(type: "retry.scheduled" | "fallback.selected", sequence: number): ExecutionEvent {
  const base = {
    schemaVersion: 1 as const,
    eventId: `event-${sequence}`,
    executionId: "execution-signals",
    sequence,
    occurredAt: `2026-01-01T12:00:0${sequence}.000Z`,
  };
  return type === "retry.scheduled"
    ? { ...base, type, attemptNumber: 1, delayMs: 10, reason: "rate limit" }
    : { ...base, type, provider: "fake-fallback", model: "fallback-v1", reason: "primary failed" };
}
