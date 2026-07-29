import type {
  ExecutionEnvelope,
  ExecutionSummary,
  InvestigationSignal,
} from "@reliability-lab/contracts";

/**
 * Derives evidence-grounded investigation signals and compact execution summaries.
 * It does not query storage or infer unsupported provider health.
 */
export function deriveInvestigationSignals(execution: ExecutionEnvelope): InvestigationSignal[] {
  const eventTypes = new Set(execution.events.map((event) => event.type));
  const signals: InvestigationSignal[] = [];
  if (
    (eventTypes.has("retry.scheduled") ||
      (execution.attempts.length > 1 &&
        execution.attempts.slice(0, -1).some((attempt) => attempt.status !== "succeeded"))) &&
    (execution.status === "succeeded" || execution.status === "degraded")
  )
    signals.push("retry_recovered");
  if (
    eventTypes.has("fallback.selected") &&
    (execution.status === "succeeded" || execution.status === "degraded")
  )
    signals.push("fallback_used");
  if (
    execution.events.some(
      (event) => event.type === "budget.exceeded" && event.budget === "latency",
    ) ||
    execution.error?.code === "latency_budget_exceeded"
  )
    signals.push("latency_budget_exceeded");
  if (eventTypes.has("structured_output.rejected")) signals.push("structured_output_rejected");
  if (
    eventTypes.has("attempt.outcome_ambiguous") ||
    execution.error?.code === "provider_call_outcome_unknown"
  )
    signals.push("provider_outcome_ambiguous");
  if (execution.replayOfExecutionId) signals.push("replay_derived");
  return signals;
}

export function projectExecutionSummary(
  execution: ExecutionEnvelope,
  comparisonCount?: number,
): ExecutionSummary {
  const finalAttempt = [...execution.attempts]
    .reverse()
    .find((attempt) => attempt.status !== "running");
  const signals = deriveInvestigationSignals(execution);
  return {
    executionId: execution.executionId,
    status: execution.status,
    createdAt: execution.createdAt,
    updatedAt: execution.updatedAt,
    initialProvider: execution.provider,
    initialModel: execution.model,
    traceId: execution.traceId,
    attemptCount: execution.attempts.length,
    retryCount: Math.max(0, execution.attempts.length - 1),
    signals,
    retryRecovered: signals.includes("retry_recovered"),
    fallbackUsed: signals.includes("fallback_used"),
    latencyBudgetExceeded: signals.includes("latency_budget_exceeded"),
    structuredOutputRejected: signals.includes("structured_output_rejected"),
    providerOutcomeAmbiguous: signals.includes("provider_outcome_ambiguous"),
    ...(comparisonCount === undefined ? {} : { comparisonCount }),
    ...(execution.durationMs === undefined ? {} : { durationMs: execution.durationMs }),
    ...(finalAttempt
      ? { finalProvider: finalAttempt.provider, finalModel: finalAttempt.model }
      : {}),
    ...(execution.error
      ? { errorCategory: execution.error.category, errorCode: execution.error.code }
      : {}),
    ...(execution.replayOfExecutionId
      ? { replayOfExecutionId: execution.replayOfExecutionId }
      : {}),
  };
}
