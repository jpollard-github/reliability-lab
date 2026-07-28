import { describe, expect, it } from "vitest";
import type { ExecutionEvent } from "@reliability-lab/contracts";
import {
  followExecutionEvents,
  formatExecutionSse,
  isTerminalExecutionEvent,
} from "../src/event-stream.js";

describe("execution event following", () => {
  it("orders backfill, follows persisted events, emits heartbeats, and stops at terminal", async () => {
    let now = 0;
    let reads = 0;
    const accepted = event(1, "execution.accepted");
    const started = event(2, "attempt.started");
    const terminal = event(3, "execution.succeeded");
    const items = [];

    for await (const item of followExecutionEvents({
      initialEvents: [started, accepted],
      afterSequence: 0,
      readAfter: async () => {
        reads += 1;
        return reads === 1 ? [] : [terminal];
      },
      signal: new AbortController().signal,
      pollMs: 5,
      heartbeatMs: 5,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      },
    })) {
      items.push(item);
    }

    expect(
      items.map((item) => (item.type === "event" ? item.event.sequence : "heartbeat")),
    ).toEqual([1, 2, "heartbeat", 3]);
    expect(isTerminalExecutionEvent(terminal)).toBe(true);
    expect(formatExecutionSse(terminal)).toContain(
      `id: 3\nevent: execution\ndata: ${JSON.stringify(terminal)}`,
    );
  });

  it("does not duplicate events at or before the reconnect cursor", async () => {
    const terminal = event(4, "execution.failed");
    const items = [];
    for await (const item of followExecutionEvents({
      initialEvents: [event(2, "attempt.started"), event(3, "attempt.failed"), terminal],
      afterSequence: 2,
      readAfter: async () => [],
      signal: new AbortController().signal,
      pollMs: 0,
    })) {
      items.push(item);
    }
    expect(items.map((item) => (item.type === "event" ? item.event.sequence : 0))).toEqual([3, 4]);
  });
});

function event(sequence: number, type: ExecutionEvent["type"]): ExecutionEvent {
  const base = {
    schemaVersion: 1 as const,
    eventId: `event-${sequence}`,
    executionId: "execution-1",
    sequence,
    occurredAt: `2026-01-01T00:00:0${sequence}.000Z`,
  };
  switch (type) {
    case "execution.accepted":
      return { ...base, type, tenantId: "tenant-a", requestHash: "hash" };
    case "attempt.started":
      return { ...base, type, attemptNumber: 1, provider: "fake", model: "v1" };
    case "attempt.failed":
      return {
        ...base,
        type,
        attemptNumber: 1,
        provider: "fake",
        model: "v1",
        latencyMs: 1,
        error: {
          category: "rate_limit",
          code: "rate_limit",
          message: "Rate limited",
          retryable: true,
        },
      };
    case "execution.succeeded":
      return { ...base, type, status: "succeeded" };
    case "execution.failed":
      return {
        ...base,
        type,
        error: {
          category: "unknown",
          code: "failed",
          message: "Failed",
          retryable: false,
        },
      };
    default:
      throw new Error(`Unsupported test event type: ${type}`);
  }
}
