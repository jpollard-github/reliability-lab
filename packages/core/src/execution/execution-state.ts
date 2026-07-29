import type { ExecutionEnvelope, ExecutionEvent } from "@reliability-lab/contracts";

/**
 * Small execution-state predicates shared by the facade and durable recovery.
 * Ambiguity is conservative: a started attempt without terminal evidence blocks a rerun.
 */
export function isTerminalStatus(status: ExecutionEnvelope["status"]): boolean {
  return ["succeeded", "degraded", "failed", "cancelled"].includes(status);
}

export function hasAmbiguousProviderAttempt(execution: ExecutionEnvelope): boolean {
  return !isTerminalStatus(execution.status) && latestUnresolvedAttempt(execution) !== undefined;
}

export function latestUnresolvedAttempt(execution: ExecutionEnvelope) {
  const started = execution.events.filter(
    (event): event is Extract<ExecutionEvent, { type: "attempt.started" }> =>
      event.type === "attempt.started",
  );
  return started.at(-1);
}
