import type { ExecutionId, TenantId } from "../common/identifiers.js";
import type { ProviderError } from "./status.js";

/**
 * Explicit execution-event payloads and stored event metadata.
 * Callers provide a payload; core adds metadata without changing the wire shape.
 */
export interface ExecutionEventMetadata {
  schemaVersion: 1;
  eventId: string;
  executionId: ExecutionId;
  sequence: number;
  occurredAt: string;
}

export interface ExecutionAcceptedEventPayload {
  type: "execution.accepted";
  tenantId: TenantId;
  requestHash: string;
}

export interface ExecutionQueuedEventPayload {
  type: "execution.queued";
}

export interface WorkerClaimedEventPayload {
  type: "worker.claimed";
}

export interface ExecutionRecoveryDetectedEventPayload {
  type: "execution.recovery_detected";
  reason: string;
}

export interface AttemptOutcomeAmbiguousEventPayload {
  type: "attempt.outcome_ambiguous";
  attemptNumber: number;
  provider: string;
  model: string;
}

export interface IdempotencyHitEventPayload {
  type: "idempotency.hit";
  idempotencyKeyHash: string;
}

export interface AttemptStartedEventPayload {
  type: "attempt.started";
  attemptNumber: number;
  provider: string;
  model: string;
}

export interface ProviderResponseReceivedEventPayload {
  type: "provider.response_received";
  attemptNumber: number;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface AttemptFailedEventPayload {
  type: "attempt.failed";
  attemptNumber: number;
  provider: string;
  model: string;
  latencyMs: number;
  error: ProviderError;
}

export interface RetryScheduledEventPayload {
  type: "retry.scheduled";
  attemptNumber: number;
  delayMs: number;
  reason: string;
}

export interface StructuredOutputRejectedEventPayload {
  type: "structured_output.rejected";
  attemptNumber: number;
  errors: string[];
}

export interface StructuredOutputValidatedEventPayload {
  type: "structured_output.validated";
  attemptNumber: number;
}

export interface FallbackSelectedEventPayload {
  type: "fallback.selected";
  provider: string;
  model: string;
  reason: string;
}

export interface BudgetExceededEventPayload {
  type: "budget.exceeded";
  budget: "latency" | "cost";
  limit: number;
  observed: number;
}

export interface CircuitOpenedEventPayload {
  type: "circuit.opened";
  provider: string;
}

export interface CircuitRejectedEventPayload {
  type: "circuit.rejected";
  provider: string;
}

export interface ExecutionSucceededEventPayload {
  type: "execution.succeeded";
  status: "succeeded" | "degraded";
}

export interface ExecutionFailedEventPayload {
  type: "execution.failed";
  error: ProviderError;
}

export interface ReplayStartedEventPayload {
  type: "replay.started";
  originalExecutionId: ExecutionId;
}

export interface ReplayCompletedEventPayload {
  type: "replay.completed";
  originalExecutionId: ExecutionId;
  replayExecutionId: ExecutionId;
  outcomeMatches: boolean | null;
}

export type ExecutionEventPayload =
  | ExecutionAcceptedEventPayload
  | ExecutionQueuedEventPayload
  | WorkerClaimedEventPayload
  | ExecutionRecoveryDetectedEventPayload
  | AttemptOutcomeAmbiguousEventPayload
  | IdempotencyHitEventPayload
  | AttemptStartedEventPayload
  | ProviderResponseReceivedEventPayload
  | AttemptFailedEventPayload
  | RetryScheduledEventPayload
  | StructuredOutputRejectedEventPayload
  | StructuredOutputValidatedEventPayload
  | FallbackSelectedEventPayload
  | BudgetExceededEventPayload
  | CircuitOpenedEventPayload
  | CircuitRejectedEventPayload
  | ExecutionSucceededEventPayload
  | ExecutionFailedEventPayload
  | ReplayStartedEventPayload
  | ReplayCompletedEventPayload;

export type ExecutionAcceptedEvent = ExecutionEventMetadata & ExecutionAcceptedEventPayload;
export type ExecutionQueuedEvent = ExecutionEventMetadata & ExecutionQueuedEventPayload;
export type WorkerClaimedEvent = ExecutionEventMetadata & WorkerClaimedEventPayload;
export type ExecutionRecoveryDetectedEvent = ExecutionEventMetadata &
  ExecutionRecoveryDetectedEventPayload;
export type AttemptOutcomeAmbiguousEvent = ExecutionEventMetadata &
  AttemptOutcomeAmbiguousEventPayload;
export type IdempotencyHitEvent = ExecutionEventMetadata & IdempotencyHitEventPayload;
export type AttemptStartedEvent = ExecutionEventMetadata & AttemptStartedEventPayload;
export type ProviderResponseReceivedEvent = ExecutionEventMetadata &
  ProviderResponseReceivedEventPayload;
export type AttemptFailedEvent = ExecutionEventMetadata & AttemptFailedEventPayload;
export type RetryScheduledEvent = ExecutionEventMetadata & RetryScheduledEventPayload;
export type StructuredOutputRejectedEvent = ExecutionEventMetadata &
  StructuredOutputRejectedEventPayload;
export type StructuredOutputValidatedEvent = ExecutionEventMetadata &
  StructuredOutputValidatedEventPayload;
export type FallbackSelectedEvent = ExecutionEventMetadata & FallbackSelectedEventPayload;
export type BudgetExceededEvent = ExecutionEventMetadata & BudgetExceededEventPayload;
export type CircuitOpenedEvent = ExecutionEventMetadata & CircuitOpenedEventPayload;
export type CircuitRejectedEvent = ExecutionEventMetadata & CircuitRejectedEventPayload;
export type ExecutionSucceededEvent = ExecutionEventMetadata & ExecutionSucceededEventPayload;
export type ExecutionFailedEvent = ExecutionEventMetadata & ExecutionFailedEventPayload;
export type ReplayStartedEvent = ExecutionEventMetadata & ReplayStartedEventPayload;
export type ReplayCompletedEvent = ExecutionEventMetadata & ReplayCompletedEventPayload;

export type ExecutionEvent =
  | ExecutionAcceptedEvent
  | ExecutionQueuedEvent
  | WorkerClaimedEvent
  | ExecutionRecoveryDetectedEvent
  | AttemptOutcomeAmbiguousEvent
  | IdempotencyHitEvent
  | AttemptStartedEvent
  | ProviderResponseReceivedEvent
  | AttemptFailedEvent
  | RetryScheduledEvent
  | StructuredOutputRejectedEvent
  | StructuredOutputValidatedEvent
  | FallbackSelectedEvent
  | BudgetExceededEvent
  | CircuitOpenedEvent
  | CircuitRejectedEvent
  | ExecutionSucceededEvent
  | ExecutionFailedEvent
  | ReplayStartedEvent
  | ReplayCompletedEvent;
