import { describe, expect, it } from "vitest";
import type {
  AttemptStartedEventPayload,
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionEventPayload,
  RetryScheduledEventPayload,
} from "@reliability-lab/contracts";
import { MemoryExecutionRepository, type Clock, type IdSource } from "../src/index.js";
import { ExecutionEventRecorder } from "../src/execution/execution-events.js";

describe("explicit execution event construction", () => {
  it("adds generated metadata consistently and persists only when requested", async () => {
    const repository = new MemoryExecutionRepository();
    const recorder = new ExecutionEventRecorder({
      repository,
      clock: fixedClock,
      ids: fixedIds,
    });
    const execution = envelope();

    const started = recorder.add(execution, {
      type: "attempt.started",
      attemptNumber: 1,
      provider: "fake-primary",
      model: "deterministic-v1",
    });
    expect(started).toEqual({
      type: "attempt.started",
      attemptNumber: 1,
      provider: "fake-primary",
      model: "deterministic-v1",
      schemaVersion: 1,
      eventId: "event-1",
      executionId: execution.executionId,
      sequence: 1,
      occurredAt: "2026-01-02T03:04:05.000Z",
    });

    await repository.create(execution);
    const retry = await recorder.append(execution, {
      type: "retry.scheduled",
      attemptNumber: 1,
      delayMs: 50,
      reason: "timeout",
    });
    expect(retry.sequence).toBe(2);
    expect(await repository.eventsAfter("tenant-a", execution.executionId, 1)).toEqual([retry]);
  });

  it("narrows stored events directly by their discriminator", () => {
    const event: ExecutionEvent = {
      type: "attempt.started",
      attemptNumber: 2,
      provider: "fake-fallback",
      model: "deterministic-v2",
      schemaVersion: 1,
      eventId: "event-2",
      executionId: "execution-1",
      sequence: 3,
      occurredAt: "2026-01-02T03:04:05.000Z",
    };

    expect(routeFromStartedEvent(event)).toBe("fake-fallback/deterministic-v2#2");
  });
});

const validStarted: AttemptStartedEventPayload = {
  type: "attempt.started",
  attemptNumber: 1,
  provider: "fake-primary",
  model: "deterministic-v1",
};
void validStarted;

// @ts-expect-error attempt.started requires attempt number, provider, and model.
const incompleteStarted: AttemptStartedEventPayload = { type: "attempt.started" };
void incompleteStarted;

// @ts-expect-error retry.scheduled requires delay and reason.
const incompleteRetry: RetryScheduledEventPayload = {
  type: "retry.scheduled",
  attemptNumber: 1,
};
void incompleteRetry;

const generatedMetadataIsNotPayload: ExecutionEventPayload = {
  type: "execution.queued",
  // @ts-expect-error callers cannot supply recorder-generated metadata.
  eventId: "caller-controlled",
};
void generatedMetadataIsNotPayload;

function routeFromStartedEvent(event: ExecutionEvent): string | undefined {
  if (event.type !== "attempt.started") return undefined;
  return `${event.provider}/${event.model}#${event.attemptNumber}`;
}

function envelope(): ExecutionEnvelope {
  return {
    schemaVersion: 1,
    executionId: "execution-1",
    tenantId: "tenant-a",
    status: "running",
    provider: "fake-primary",
    model: "deterministic-v1",
    traceId: "trace-1",
    requestHash: "request-1",
    policy: {
      maxAttempts: 2,
      baseBackoffMs: 50,
      maxBackoffMs: 1_000,
      jitterRatio: 0.2,
    },
    budget: { maxLatencyMs: 10_000 },
    attempts: [],
    events: [],
    createdAt: "2026-01-02T03:04:05.000Z",
    updatedAt: "2026-01-02T03:04:05.000Z",
    replayCapability: {
      state: "missing",
      available: false,
      reason: "Replay capsule is unavailable",
    },
    replayable: false,
  };
}

const fixedClock: Clock = {
  now: () => new Date("2026-01-02T03:04:05.000Z"),
  sleep: async () => undefined,
};

let eventNumber = 0;

const fixedIds: IdSource = {
  executionId: () => "execution-fixed",
  experimentId: () => "experiment-fixed",
  eventId: () => `event-${++eventNumber}`,
  traceId: () => "trace-fixed",
};
