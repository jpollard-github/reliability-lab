import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@reliability-lab/contracts";
import { projectExecutionEvents } from "./execution-machine.js";

describe("execution machine projection", () => {
  it("projects the real retry route without inventing steps", () => {
    const projection = projectExecutionEvents([
      accepted(1),
      started(2, 1, "primary"),
      failed(3, 1, "primary"),
      {
        ...base(4),
        type: "retry.scheduled",
        attemptNumber: 1,
        delayMs: 750,
        reason: "rate_limit",
      },
      started(5, 2, "primary"),
      responded(6, 2, "primary"),
      { ...base(7), type: "execution.succeeded", status: "succeeded" },
    ]);

    expect(projection.steps.map((step) => step.kind)).toEqual([
      "input",
      "attempt",
      "observation",
      "retry",
      "attempt",
      "observation",
      "outcome",
    ]);
    expect(projection.steps[2]?.detail).toContain("rate_limit");
    expect(projection.steps[3]?.detail).toContain("750 ms real backoff");
    expect(projection.status).toBe("succeeded");
    expect(projection.terminal).toBe(true);
  });

  it("projects fallback, validation, circuit, and budget evidence only when recorded", () => {
    const projection = projectExecutionEvents([
      accepted(1),
      failed(2, 1, "primary"),
      {
        ...base(3),
        type: "fallback.selected",
        provider: "fallback",
        model: "v2",
        reason: "provider_unavailable",
      },
      { ...base(4), type: "structured_output.validated", attemptNumber: 2 },
      { ...base(5), type: "circuit.rejected", provider: "secondary" },
      {
        ...base(6),
        type: "budget.exceeded",
        budget: "latency",
        limit: 100,
        observed: 125,
      },
      {
        ...base(7),
        type: "execution.failed",
        error: {
          category: "budget_exceeded",
          code: "latency_budget_exceeded",
          message: "Budget exceeded",
          retryable: false,
        },
      },
    ]);

    expect(projection.steps.map((step) => step.kind)).toEqual([
      "input",
      "observation",
      "fallback",
      "validator",
      "circuit",
      "budget",
      "outcome",
    ]);
    expect(projection.steps.find((step) => step.kind === "budget")?.detail).toContain("125");
    expect(projection.status).toBe("failed");
  });

  it("sorts and deduplicates sequence evidence for reconnect-safe rendering", () => {
    const duplicate = responded(3, 1, "primary");
    const projection = projectExecutionEvents([duplicate, accepted(1), duplicate]);
    expect(projection.steps.map((step) => step.sequence)).toEqual([1, 3]);
    expect(projection.terminal).toBe(false);
    expect(projection.status).toBe("running");
    expect(projection.realEventSpanMs).toBe(2_000);
  });
});

function base(sequence: number) {
  return {
    schemaVersion: 1 as const,
    eventId: `event-${sequence}`,
    executionId: "execution-1",
    sequence,
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
  };
}

function accepted(sequence: number): ExecutionEvent {
  return {
    ...base(sequence),
    type: "execution.accepted",
    tenantId: "tenant-a",
    requestHash: "hash",
  };
}

function started(sequence: number, attemptNumber: number, provider: string): ExecutionEvent {
  return {
    ...base(sequence),
    type: "attempt.started",
    attemptNumber,
    provider,
    model: "v1",
  };
}

function responded(sequence: number, attemptNumber: number, provider: string): ExecutionEvent {
  return {
    ...base(sequence),
    type: "provider.response_received",
    attemptNumber,
    provider,
    model: "v1",
    latencyMs: 1,
  };
}

function failed(sequence: number, attemptNumber: number, provider: string): ExecutionEvent {
  return {
    ...base(sequence),
    type: "attempt.failed",
    attemptNumber,
    provider,
    model: "v1",
    latencyMs: 1,
    error: {
      category: "rate_limit",
      code: "rate_limit",
      message: "Rate limited",
      retryable: true,
    },
  };
}
