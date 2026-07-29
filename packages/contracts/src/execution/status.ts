import { Type, type Static } from "@sinclair/typebox";

/**
 * Execution, attempt, job, and normalized failure states.
 * This module names lifecycle vocabulary; it does not model provider requests or envelopes.
 */
export const ExecutionStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("degraded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type ExecutionStatus = Static<typeof ExecutionStatusSchema>;

export const ExecutionJobStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("leased"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("ambiguous"),
]);
export type ExecutionJobStatus = Static<typeof ExecutionJobStatusSchema>;

export const AttemptStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("timed_out"),
  Type.Literal("rejected"),
]);
export type AttemptStatus = Static<typeof AttemptStatusSchema>;

export const FailureModeSchema = Type.Union([
  Type.Literal("latency"),
  Type.Literal("timeout"),
  Type.Literal("rate_limit"),
  Type.Literal("malformed_json"),
  Type.Literal("provider_error"),
]);
export type FailureMode = Static<typeof FailureModeSchema>;

export const ProviderErrorCategorySchema = Type.Union([
  Type.Literal("timeout"),
  Type.Literal("rate_limit"),
  Type.Literal("authentication"),
  Type.Literal("invalid_request"),
  Type.Literal("provider_unavailable"),
  Type.Literal("malformed_response"),
  Type.Literal("budget_exceeded"),
  Type.Literal("unknown"),
]);
export type ProviderErrorCategory = Static<typeof ProviderErrorCategorySchema>;

export interface ProviderError {
  category: ProviderErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}
