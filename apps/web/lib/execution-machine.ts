import type { ExecutionEvent, ExecutionStatus } from "@reliability-lab/contracts";

type MachineStepKind =
  | "input"
  | "attempt"
  | "observation"
  | "retry"
  | "fallback"
  | "validator"
  | "budget"
  | "circuit"
  | "outcome"
  | "replay"
  | "decision";

interface MachineStep {
  id: string;
  sequence: number;
  kind: MachineStepKind;
  title: string;
  detail: string;
  occurredAt: string;
  tone: "neutral" | "active" | "success" | "warning" | "danger";
  attemptNumber?: number;
}

interface ExecutionMachineProjection {
  steps: MachineStep[];
  latestSequence: number;
  terminal: boolean;
  status: ExecutionStatus;
  realEventSpanMs: number;
}

export function projectExecutionEvents(events: ExecutionEvent[]): ExecutionMachineProjection {
  const ordered = [...new Map(events.map((event) => [event.sequence, event])).values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const steps = ordered.map(toMachineStep);
  const terminalEvent = [...ordered]
    .reverse()
    .find((event) => event.type === "execution.succeeded" || event.type === "execution.failed");
  const queued = ordered.some((event) => event.type === "execution.queued");
  const claimed = ordered.some((event) => event.type === "worker.claimed");
  const firstTime = ordered[0] ? Date.parse(ordered[0].occurredAt) : 0;
  const lastTime = ordered.at(-1) ? Date.parse(ordered.at(-1)!.occurredAt) : firstTime;
  return {
    steps,
    latestSequence: ordered.at(-1)?.sequence ?? 0,
    terminal: terminalEvent !== undefined,
    status:
      terminalEvent?.type === "execution.succeeded"
        ? terminalEvent.status
        : terminalEvent?.type === "execution.failed"
          ? "failed"
          : queued && !claimed
            ? "queued"
            : "running",
    realEventSpanMs: Math.max(0, lastTime - firstTime),
  };
}

function toMachineStep(event: ExecutionEvent): MachineStep {
  const base = {
    id: event.eventId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
  };
  switch (event.type) {
    case "execution.accepted":
      return {
        ...base,
        kind: "input",
        title: "Request accepted",
        detail: "Validated request entered the execution service.",
        tone: "success",
      };
    case "idempotency.hit":
      return {
        ...base,
        kind: "decision",
        title: "Idempotency hit",
        detail: "The existing execution was reused.",
        tone: "warning",
      };
    case "execution.queued":
      return {
        ...base,
        kind: "decision",
        title: "Execution queued",
        detail: "The encrypted command is waiting for a durable worker lease.",
        tone: "active",
      };
    case "worker.claimed":
      return {
        ...base,
        kind: "decision",
        title: "Worker claimed execution",
        detail: "A durable worker acquired the execution lease.",
        tone: "active",
      };
    case "execution.recovery_detected":
      return {
        ...base,
        kind: "decision",
        title: "Recovery detected",
        detail: event.reason,
        tone: "warning",
      };
    case "attempt.outcome_ambiguous":
      return {
        ...base,
        kind: "outcome",
        title: "Provider outcome ambiguous",
        detail: `Attempt ${event.attemptNumber} on ${event.provider} / ${event.model} will not be repeated automatically.`,
        tone: "danger",
        attemptNumber: event.attemptNumber,
      };
    case "attempt.started":
      return {
        ...base,
        kind: "attempt",
        title: `Attempt ${event.attemptNumber} started`,
        detail: `${event.provider} / ${event.model}`,
        tone: "active",
        attemptNumber: event.attemptNumber,
      };
    case "provider.response_received":
      return {
        ...base,
        kind: "observation",
        title: `Attempt ${event.attemptNumber} responded`,
        detail: `${event.provider} / ${event.model} · ${event.latencyMs} ms`,
        tone: "success",
        attemptNumber: event.attemptNumber,
      };
    case "attempt.failed":
      return {
        ...base,
        kind: "observation",
        title: `Attempt ${event.attemptNumber} failed`,
        detail: `${event.error.category} · ${event.error.code} · ${
          event.error.retryable ? "retryable" : "not retryable"
        } · ${event.latencyMs} ms`,
        tone: "danger",
        attemptNumber: event.attemptNumber,
      };
    case "retry.scheduled":
      return {
        ...base,
        kind: "retry",
        title: "Retry scheduled",
        detail: `${event.delayMs} ms real backoff after ${event.reason}`,
        tone: "warning",
        attemptNumber: event.attemptNumber,
      };
    case "fallback.selected":
      return {
        ...base,
        kind: "fallback",
        title: "Fallback selected",
        detail: `${event.provider} / ${event.model} after ${event.reason}`,
        tone: "warning",
      };
    case "structured_output.validated":
      return {
        ...base,
        kind: "validator",
        title: "Structured output valid",
        detail: `Attempt ${event.attemptNumber} passed schema validation.`,
        tone: "success",
        attemptNumber: event.attemptNumber,
      };
    case "structured_output.rejected":
      return {
        ...base,
        kind: "validator",
        title: "Structured output rejected",
        detail: event.errors.join("; "),
        tone: "danger",
        attemptNumber: event.attemptNumber,
      };
    case "budget.exceeded":
      return {
        ...base,
        kind: "budget",
        title: `${capitalize(event.budget)} budget exceeded`,
        detail: `Observed ${event.observed}; limit ${event.limit}.`,
        tone: "danger",
      };
    case "circuit.opened":
      return {
        ...base,
        kind: "circuit",
        title: "Circuit opened",
        detail: event.provider,
        tone: "danger",
      };
    case "circuit.rejected":
      return {
        ...base,
        kind: "circuit",
        title: "Circuit rejected request",
        detail: `${event.provider} was not called.`,
        tone: "danger",
      };
    case "execution.succeeded":
      return {
        ...base,
        kind: "outcome",
        title: event.status === "degraded" ? "Degraded success" : "Execution succeeded",
        detail:
          event.status === "degraded"
            ? "A fallback route produced the accepted outcome."
            : "The active route produced the accepted outcome.",
        tone: event.status === "degraded" ? "warning" : "success",
      };
    case "execution.failed":
      return {
        ...base,
        kind: "outcome",
        title: "Execution failed",
        detail: `${event.error.category} · ${event.error.code}`,
        tone: "danger",
      };
    case "replay.started":
      return {
        ...base,
        kind: "replay",
        title: "Replay started",
        detail: `Original execution ${event.originalExecutionId}`,
        tone: "active",
      };
    case "replay.completed":
      return {
        ...base,
        kind: "replay",
        title: "Replay completed",
        detail:
          event.outcomeMatches === null
            ? "The replay is queued; outcome comparison is pending."
            : event.outcomeMatches
              ? "Normalized outcome matched the original."
              : "Normalized outcome differed from the original.",
        tone:
          event.outcomeMatches === null ? "active" : event.outcomeMatches ? "success" : "warning",
      };
  }
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
