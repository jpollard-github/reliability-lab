/** Maps compact investigation SQL rows into conservative public read models. */
import type {
  ExecutionSummary,
  ProviderObservation,
  ReliabilityTrendBucket,
} from "@reliability-lab/contracts";
import type { AggregateRow, ProviderRow, SearchRow, TrendRow } from "./investigation-row-types.js";
import { isoValue, nullableNumber, numberValue, rate } from "./sql-values.js";

export function toExecutionSummary(row: SearchRow): ExecutionSummary {
  return {
    executionId: row.executionId,
    status: row.status,
    createdAt: isoValue(row.createdAt),
    updatedAt: isoValue(row.updatedAt),
    initialProvider: row.initialProvider,
    initialModel: row.initialModel,
    traceId: row.traceId,
    attemptCount: numberValue(row.attemptCount),
    retryCount: numberValue(row.retryCount),
    signals: [
      ...(row.retryRecovered ? (["retry_recovered"] as const) : []),
      ...(row.fallbackUsed ? (["fallback_used"] as const) : []),
      ...(row.latencyBudgetExceeded ? (["latency_budget_exceeded"] as const) : []),
      ...(row.structuredOutputRejected ? (["structured_output_rejected"] as const) : []),
      ...(row.providerOutcomeAmbiguous ? (["provider_outcome_ambiguous"] as const) : []),
      ...(row.replayOfExecutionId ? (["replay_derived"] as const) : []),
    ],
    retryRecovered: row.retryRecovered,
    fallbackUsed: row.fallbackUsed,
    latencyBudgetExceeded: row.latencyBudgetExceeded,
    structuredOutputRejected: row.structuredOutputRejected,
    providerOutcomeAmbiguous: row.providerOutcomeAmbiguous,
    comparisonCount: numberValue(row.comparisonCount),
    ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    ...(row.finalProvider === null ? {} : { finalProvider: row.finalProvider }),
    ...(row.finalModel === null ? {} : { finalModel: row.finalModel }),
    ...(row.errorCategory === null ? {} : { errorCategory: row.errorCategory }),
    ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
    ...(row.replayOfExecutionId === null ? {} : { replayOfExecutionId: row.replayOfExecutionId }),
  };
}

export function toTrendBucket(row: TrendRow): ReliabilityTrendBucket {
  return {
    from: isoValue(row.bucketFrom),
    to: isoValue(row.bucketTo),
    total: numberValue(row.total),
    terminal: numberValue(row.terminal),
    succeeded: numberValue(row.succeeded),
    degraded: numberValue(row.degraded),
    failed: numberValue(row.failed),
  };
}

export function toProviderObservation(row: ProviderRow): ProviderObservation {
  const attemptCount = numberValue(row.attemptCount);
  const terminalAttemptCount = numberValue(row.terminalAttemptCount);
  const succeededAttempts = numberValue(row.succeededAttempts);
  return {
    provider: row.provider,
    model: row.model,
    attemptCount,
    executionCount: numberValue(row.executionCount),
    terminalAttemptCount,
    succeededAttempts,
    failedAttempts: numberValue(row.failedAttempts),
    timedOutAttempts: numberValue(row.timedOutAttempts),
    rejectedAttempts: numberValue(row.rejectedAttempts),
    runningAttempts: numberValue(row.runningAttempts),
    observedSuccessRate: rate(succeededAttempts, terminalAttemptCount),
    latencySampleSize: numberValue(row.latencySampleSize),
    p50LatencyMs: nullableNumber(row.p50LatencyMs),
    p95LatencyMs: nullableNumber(row.p95LatencyMs),
    rateLimitedAttempts: numberValue(row.rateLimitedAttempts),
    providerUnavailableAttempts: numberValue(row.providerUnavailableAttempts),
    providerErrors: numberValue(row.providerErrors),
    structuredOutputRejections: numberValue(row.structuredOutputRejections),
    fallbackSelectedToRoute: numberValue(row.fallbackSelectedToRoute),
    sampleAssessment:
      attemptCount === 0 ? "no_evidence" : attemptCount < 5 ? "insufficient_sample" : "observed",
  };
}

export function emptyAggregate(): AggregateRow {
  return {
    total: 0,
    terminal: 0,
    queued: 0,
    running: 0,
    cancelled: 0,
    succeeded: 0,
    degraded: 0,
    failed: 0,
    retryRecovered: 0,
    fallbackUsed: 0,
    latencyBudgetExceeded: 0,
    structuredOutputRejected: 0,
    providerOutcomeAmbiguous: 0,
    rateLimitFailures: 0,
    timeoutFailures: 0,
    providerUnavailableFailures: 0,
    latencySampleSize: 0,
    p50Ms: null,
    p95Ms: null,
    executionCoverage: 0,
    costCoverage: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    completedComparisons: 0,
    reproducibilityChecks: 0,
    exactOutputMatches: 0,
  };
}
