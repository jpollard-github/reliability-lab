import type {
  ExecutionEnvelope,
  ExecutionStatus,
  InvestigationRange,
  ReliabilitySummary,
  ReliabilityTrendBucket,
} from "@reliability-lab/contracts";
import { DEFAULT_RANGE_MS } from "./range.js";
import { projectExecutionSummary } from "./signals.js";
import { percentile, rate, sum } from "./statistics.js";

const TERMINAL_STATUSES = new Set<ExecutionStatus>([
  "succeeded",
  "degraded",
  "failed",
  "cancelled",
]);

/**
 * Aggregates execution evidence into reliability outcomes, usage, latency, and trends.
 * It does not query storage or assign provider health scores.
 */
export function summarizeReliability(
  executions: ExecutionEnvelope[],
  range: InvestigationRange,
): ReliabilitySummary {
  const count = (status: ExecutionStatus) =>
    executions.filter((execution) => execution.status === status).length;
  const succeeded = count("succeeded");
  const degraded = count("degraded");
  const failed = count("failed");
  const terminal = succeeded + degraded + failed + count("cancelled");
  const summaries = executions.map((execution) => projectExecutionSummary(execution));
  const completedDurations = executions
    .filter((execution) => TERMINAL_STATUSES.has(execution.status))
    .flatMap((execution) => (execution.durationMs === undefined ? [] : [execution.durationMs]));
  const usageExecutions = executions.filter((execution) =>
    execution.attempts.some((attempt) => attempt.usage),
  );
  const costExecutions = executions.filter((execution) =>
    execution.attempts.some((attempt) => attempt.usage?.estimatedCostUsd !== undefined),
  );
  const allUsage = executions.flatMap((execution) =>
    execution.attempts.flatMap((attempt) => (attempt.usage ? [attempt.usage] : [])),
  );
  const replayChecks = executions.flatMap((execution) =>
    execution.events.filter((event) => event.type === "replay.completed"),
  );
  return {
    range,
    population: {
      total: executions.length,
      terminal,
      inFlight: count("queued") + count("running"),
      queued: count("queued"),
      running: count("running"),
      cancelled: count("cancelled"),
    },
    outcomes: {
      succeeded,
      degraded,
      failed,
      successRate: rate(succeeded, terminal),
      degradedRate: rate(degraded, terminal),
      failureRate: rate(failed, terminal),
    },
    signals: {
      retryRecovered: summaries.filter((item) => item.signals.includes("retry_recovered")).length,
      fallbackUsed: summaries.filter((item) => item.signals.includes("fallback_used")).length,
      latencyBudgetExceeded: summaries.filter((item) =>
        item.signals.includes("latency_budget_exceeded"),
      ).length,
      structuredOutputRejected: summaries.filter((item) =>
        item.signals.includes("structured_output_rejected"),
      ).length,
      providerOutcomeAmbiguous: summaries.filter((item) =>
        item.signals.includes("provider_outcome_ambiguous"),
      ).length,
      rateLimitFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "rate_limit"),
      ).length,
      timeoutFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "timeout"),
      ).length,
      providerUnavailableFailures: executions.filter((execution) =>
        execution.attempts.some((attempt) => attempt.error?.category === "provider_unavailable"),
      ).length,
    },
    latency: {
      sampleSize: completedDurations.length,
      p50Ms: percentile(completedDurations, 0.5),
      p95Ms: percentile(completedDurations, 0.95),
    },
    usage: {
      executionCoverage: usageExecutions.length,
      costCoverage: costExecutions.length,
      inputTokens: sum(allUsage.map((usage) => usage.inputTokens)),
      outputTokens: sum(allUsage.map((usage) => usage.outputTokens)),
      estimatedCostUsd: sum(allUsage.map((usage) => usage.estimatedCostUsd ?? 0)),
    },
    comparisons: {
      completed: 0,
      reproducibilityChecks: replayChecks.length,
      exactOutputMatches: replayChecks.filter(
        (event) => event.type === "replay.completed" && event.outcomeMatches === true,
      ).length,
    },
    trend: buildTrend(executions, range),
  };
}
function buildTrend(
  executions: ExecutionEnvelope[],
  range: InvestigationRange,
): ReliabilityTrendBucket[] {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const bucketMs =
    to.getTime() - from.getTime() <= DEFAULT_RANGE_MS ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000;
  const buckets: ReliabilityTrendBucket[] = [];
  for (let cursor = from.getTime(); cursor < to.getTime(); cursor += bucketMs) {
    const bucketTo = Math.min(cursor + bucketMs, to.getTime());
    const members = executions.filter((execution) => {
      const createdAt = new Date(execution.createdAt).getTime();
      return createdAt >= cursor && createdAt < bucketTo;
    });
    const succeeded = members.filter((item) => item.status === "succeeded").length;
    const degraded = members.filter((item) => item.status === "degraded").length;
    const failed = members.filter((item) => item.status === "failed").length;
    const cancelled = members.filter((item) => item.status === "cancelled").length;
    buckets.push({
      from: new Date(cursor).toISOString(),
      to: new Date(bucketTo).toISOString(),
      total: members.length,
      terminal: succeeded + degraded + failed + cancelled,
      succeeded,
      degraded,
      failed,
    });
  }
  return buckets;
}
