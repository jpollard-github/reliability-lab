/**
 * Translates execution domain evidence to PostgreSQL inserts and reconstructs full envelopes.
 * It preserves representation only; execution policy remains in core.
 */
import type { ExecutionEnvelope, ExecutionEvent } from "@reliability-lab/contracts";
import type { executionAttempts, executionEvents, executions } from "../schema/executions.js";

export function toExecutionInsert(execution: ExecutionEnvelope): typeof executions.$inferInsert {
  return {
    id: execution.executionId,
    tenantId: execution.tenantId,
    status: execution.status,
    provider: execution.provider,
    model: execution.model,
    traceId: execution.traceId,
    requestHash: execution.requestHash,
    policy: execution.policy,
    budget: execution.budget,
    outputText: execution.outputText,
    outputJson: execution.outputJson,
    error: execution.error,
    replayOfExecutionId: execution.replayOfExecutionId,
    replayable: execution.replayable,
    replayUnavailableReason: execution.replayUnavailableReason,
    durationMs: execution.durationMs,
    createdAt: new Date(execution.createdAt),
    updatedAt: new Date(execution.updatedAt),
  };
}

export function toExecutionUpdate(execution: ExecutionEnvelope) {
  return {
    status: execution.status,
    provider: execution.provider,
    model: execution.model,
    outputText: execution.outputText ?? null,
    outputJson: execution.outputJson ?? null,
    error: execution.error ?? null,
    replayable: execution.replayable,
    replayUnavailableReason: execution.replayUnavailableReason ?? null,
    durationMs: execution.durationMs ?? null,
    updatedAt: new Date(execution.updatedAt),
  };
}

export function toExecutionEventInsert(event: ExecutionEvent): typeof executionEvents.$inferInsert {
  return {
    eventId: event.eventId,
    executionId: event.executionId,
    sequence: event.sequence,
    schemaVersion: event.schemaVersion,
    type: event.type,
    occurredAt: new Date(event.occurredAt),
    data: event,
  };
}

export function hydrateExecution(
  row: typeof executions.$inferSelect,
  attemptRows: (typeof executionAttempts.$inferSelect)[],
  eventRows: (typeof executionEvents.$inferSelect)[],
): ExecutionEnvelope {
  return {
    schemaVersion: 1,
    executionId: row.id,
    tenantId: row.tenantId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    traceId: row.traceId,
    requestHash: row.requestHash,
    policy: row.policy,
    budget: row.budget,
    attempts: attemptRows.map((attempt) => attempt.data),
    events: eventRows.map((event) => event.data),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    replayCapability: row.replayable
      ? {
          state: "available",
          available: true,
          reason: "Replay capsule is available",
        }
      : {
          state:
            row.replayUnavailableReason === "Live-provider request retention is disabled"
              ? "retention_disabled"
              : "missing",
          available: false,
          reason: row.replayUnavailableReason ?? "Replay capsule is unavailable",
        },
    replayable: row.replayable,
    ...(row.outputText === null ? {} : { outputText: row.outputText }),
    ...(row.outputJson === null ? {} : { outputJson: row.outputJson }),
    ...(row.error === null ? {} : { error: row.error }),
    ...(row.replayOfExecutionId === null ? {} : { replayOfExecutionId: row.replayOfExecutionId }),
    ...(row.replayUnavailableReason === null
      ? {}
      : { replayUnavailableReason: row.replayUnavailableReason }),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
  };
}
