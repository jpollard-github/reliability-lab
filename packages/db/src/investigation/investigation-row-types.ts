import type { ExecutionStatus, ProviderErrorCategory } from "@reliability-lab/contracts";

export type SearchRow = {
  executionId: string;
  status: ExecutionStatus;
  createdAt: Date | string;
  updatedAt: Date | string;
  durationMs: number | null;
  initialProvider: string;
  initialModel: string;
  finalProvider: string | null;
  finalModel: string | null;
  traceId: string;
  attemptCount: number | string;
  retryCount: number | string;
  retryRecovered: boolean;
  fallbackUsed: boolean;
  latencyBudgetExceeded: boolean;
  structuredOutputRejected: boolean;
  providerOutcomeAmbiguous: boolean;
  replayOfExecutionId: string | null;
  errorCategory: ProviderErrorCategory | null;
  errorCode: string | null;
  comparisonCount: number | string;
};

export type CountRow = { totalCount: number | string };

export type AggregateRow = {
  total: number | string;
  terminal: number | string;
  queued: number | string;
  running: number | string;
  cancelled: number | string;
  succeeded: number | string;
  degraded: number | string;
  failed: number | string;
  retryRecovered: number | string;
  fallbackUsed: number | string;
  latencyBudgetExceeded: number | string;
  structuredOutputRejected: number | string;
  providerOutcomeAmbiguous: number | string;
  rateLimitFailures: number | string;
  timeoutFailures: number | string;
  providerUnavailableFailures: number | string;
  latencySampleSize: number | string;
  p50Ms: number | string | null;
  p95Ms: number | string | null;
  executionCoverage: number | string;
  costCoverage: number | string;
  inputTokens: number | string;
  outputTokens: number | string;
  estimatedCostUsd: number | string;
  completedComparisons: number | string;
  reproducibilityChecks: number | string;
  exactOutputMatches: number | string;
};

export type TrendRow = {
  bucketFrom: Date | string;
  bucketTo: Date | string;
  total: number | string;
  terminal: number | string;
  succeeded: number | string;
  degraded: number | string;
  failed: number | string;
};

export type ProviderRow = {
  provider: string;
  model: string;
  attemptCount: number | string;
  executionCount: number | string;
  terminalAttemptCount: number | string;
  succeededAttempts: number | string;
  failedAttempts: number | string;
  timedOutAttempts: number | string;
  rejectedAttempts: number | string;
  runningAttempts: number | string;
  latencySampleSize: number | string;
  p50LatencyMs: number | string | null;
  p95LatencyMs: number | string | null;
  rateLimitedAttempts: number | string;
  providerUnavailableAttempts: number | string;
  providerErrors: number | string;
  structuredOutputRejections: number | string;
  fallbackSelectedToRoute: number | string;
};
