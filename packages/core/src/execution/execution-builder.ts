import type { ExecutionEnvelope, ExecutionPolicy } from "@reliability-lab/contracts";
import type { ExecuteCommand } from "./commands.js";
import type { ExecutionEventRecorder } from "./execution-events.js";
import type { Clock, IdSource } from "../infrastructure/clock.js";
import { unavailableCapability } from "../replay/replay-store.js";

const DEFAULT_POLICY: ExecutionPolicy = {
  maxAttempts: 2,
  baseBackoffMs: 50,
  maxBackoffMs: 1_000,
  jitterRatio: 0.2,
};
const DEFAULT_BUDGET = { maxLatencyMs: 10_000 };

/**
 * Prepares a new accepted execution envelope and its initial in-memory events.
 * It does not persist acceptance, retain replay data, or run provider policy.
 */
export function prepareExecution(options: {
  command: ExecuteCommand;
  requestHash: string;
  durable: boolean;
  clock: Clock;
  ids: IdSource;
  events: ExecutionEventRecorder;
}): ExecutionEnvelope {
  const { command, requestHash, durable, clock, ids, events } = options;
  const createdAt = clock.now().toISOString();
  const execution: ExecutionEnvelope = {
    schemaVersion: 1,
    executionId: ids.executionId(),
    tenantId: command.tenantId,
    status: durable ? "queued" : "running",
    provider: command.body.provider,
    model: command.body.model,
    traceId: ids.traceId(),
    requestHash,
    policy: { ...DEFAULT_POLICY, ...command.body.policy },
    budget: { ...DEFAULT_BUDGET, ...command.body.budget },
    attempts: [],
    events: [],
    createdAt,
    updatedAt: createdAt,
    replayCapability: unavailableCapability("missing", "Replay capsule has not been retained"),
    replayable: false,
    ...(command.replayOfExecutionId ? { replayOfExecutionId: command.replayOfExecutionId } : {}),
  };
  events.add(execution, {
    type: "execution.accepted",
    tenantId: command.tenantId,
    requestHash,
  });
  if (command.replayOfExecutionId) {
    events.add(execution, {
      type: "replay.started",
      originalExecutionId: command.replayOfExecutionId,
    });
  }
  if (durable) events.add(execution, { type: "execution.queued" });
  return execution;
}
