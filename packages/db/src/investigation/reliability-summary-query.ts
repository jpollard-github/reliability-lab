/**
 * Owns the two fixed reliability-summary statements: aggregate evidence and bounded trend buckets.
 * Missing evidence remains unavailable through null rates rather than being fabricated as zero.
 */
import { sql } from "drizzle-orm";
import type { InvestigationRange, ReliabilitySummary, TenantId } from "@reliability-lab/contracts";
import type { ReliabilityDatabase } from "../database/database.js";
import type { AggregateRow, TrendRow } from "./investigation-row-types.js";
import { emptyAggregate, toTrendBucket } from "./investigation-row-mappers.js";
import { nullableNumber, numberValue, rate } from "./sql-values.js";

export async function summarizeReliability(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  range: InvestigationRange,
): Promise<ReliabilitySummary> {
  const bucketInterval =
    new Date(range.to).getTime() - new Date(range.from).getTime() <= 24 * 60 * 60 * 1_000
      ? "1 hour"
      : "1 day";
  const [aggregateResult, trendResult] = await Promise.all([
    db.execute<AggregateRow>(sql`
      WITH base AS (
        SELECT e.*
        FROM executions e
        WHERE e.tenant_id = ${tenantId}
          AND e.created_at >= ${new Date(range.from)}
          AND e.created_at < ${new Date(range.to)}
      ),
      usage_by_execution AS (
        SELECT
          a.execution_id,
          COUNT(*) FILTER (WHERE a.data->'usage' IS NOT NULL) > 0 AS has_usage,
          COUNT(*) FILTER (
            WHERE a.data #>> '{usage,estimatedCostUsd}' IS NOT NULL
          ) > 0 AS has_cost,
          COALESCE(SUM(NULLIF(a.data #>> '{usage,inputTokens}', '')::bigint), 0) AS input_tokens,
          COALESCE(SUM(NULLIF(a.data #>> '{usage,outputTokens}', '')::bigint), 0) AS output_tokens,
          COALESCE(SUM(NULLIF(a.data #>> '{usage,estimatedCostUsd}', '')::numeric), 0) AS cost
        FROM execution_attempts a
        JOIN base b ON b.id = a.execution_id
        GROUP BY a.execution_id
      )
      SELECT
        COUNT(*)::integer AS "total",
        COUNT(*) FILTER (
          WHERE b.status IN ('succeeded', 'degraded', 'failed', 'cancelled')
        )::integer AS "terminal",
        COUNT(*) FILTER (WHERE b.status = 'queued')::integer AS "queued",
        COUNT(*) FILTER (WHERE b.status = 'running')::integer AS "running",
        COUNT(*) FILTER (WHERE b.status = 'cancelled')::integer AS "cancelled",
        COUNT(*) FILTER (WHERE b.status = 'succeeded')::integer AS "succeeded",
        COUNT(*) FILTER (WHERE b.status = 'degraded')::integer AS "degraded",
        COUNT(*) FILTER (WHERE b.status = 'failed')::integer AS "failed",
        COUNT(*) FILTER (
          WHERE b.status IN ('succeeded', 'degraded')
            AND (
              EXISTS (
                SELECT 1 FROM execution_events ev
                WHERE ev.execution_id = b.id AND ev.type = 'retry.scheduled'
              )
              OR (
                (SELECT COUNT(*) FROM execution_attempts a WHERE a.execution_id = b.id) > 1
                AND EXISTS (
                  SELECT 1 FROM execution_attempts a
                  WHERE a.execution_id = b.id AND a.data->>'status' <> 'succeeded'
                )
              )
            )
        )::integer AS "retryRecovered",
        COUNT(*) FILTER (
          WHERE b.status IN ('succeeded', 'degraded')
            AND EXISTS (
              SELECT 1 FROM execution_events ev
              WHERE ev.execution_id = b.id AND ev.type = 'fallback.selected'
            )
        )::integer AS "fallbackUsed",
        COUNT(*) FILTER (
          WHERE b.error->>'code' = 'latency_budget_exceeded'
            OR EXISTS (
              SELECT 1 FROM execution_events ev
              WHERE ev.execution_id = b.id
                AND ev.type = 'budget.exceeded'
                AND ev.data->>'budget' = 'latency'
            )
        )::integer AS "latencyBudgetExceeded",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = b.id AND ev.type = 'structured_output.rejected'
          )
        )::integer AS "structuredOutputRejected",
        COUNT(*) FILTER (
          WHERE b.error->>'code' = 'provider_call_outcome_unknown'
            OR EXISTS (
              SELECT 1 FROM execution_events ev
              WHERE ev.execution_id = b.id AND ev.type = 'attempt.outcome_ambiguous'
            )
        )::integer AS "providerOutcomeAmbiguous",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM execution_attempts a
            WHERE a.execution_id = b.id
              AND a.data #>> '{error,category}' = 'rate_limit'
          )
        )::integer AS "rateLimitFailures",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM execution_attempts a
            WHERE a.execution_id = b.id
              AND a.data #>> '{error,category}' = 'timeout'
          )
        )::integer AS "timeoutFailures",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM execution_attempts a
            WHERE a.execution_id = b.id
              AND a.data #>> '{error,category}' = 'provider_unavailable'
          )
        )::integer AS "providerUnavailableFailures",
        COUNT(b.duration_ms) FILTER (
          WHERE b.status IN ('succeeded', 'degraded', 'failed', 'cancelled')
        )::integer AS "latencySampleSize",
        percentile_disc(0.5) WITHIN GROUP (ORDER BY b.duration_ms) FILTER (
          WHERE b.status IN ('succeeded', 'degraded', 'failed', 'cancelled')
            AND b.duration_ms IS NOT NULL
        ) AS "p50Ms",
        percentile_disc(0.95) WITHIN GROUP (ORDER BY b.duration_ms) FILTER (
          WHERE b.status IN ('succeeded', 'degraded', 'failed', 'cancelled')
            AND b.duration_ms IS NOT NULL
        ) AS "p95Ms",
        COUNT(*) FILTER (WHERE u.has_usage)::integer AS "executionCoverage",
        COUNT(*) FILTER (WHERE u.has_cost)::integer AS "costCoverage",
        COALESCE(SUM(u.input_tokens), 0) AS "inputTokens",
        COALESCE(SUM(u.output_tokens), 0) AS "outputTokens",
        COALESCE(SUM(u.cost), 0) AS "estimatedCostUsd",
        (
          SELECT COUNT(DISTINCT comparison.id)::integer
          FROM comparison_experiments comparison
          JOIN base compared
            ON compared.id = comparison.original_execution_id
            OR compared.id = comparison.variant_execution_id
          WHERE comparison.tenant_id = ${tenantId}
            AND comparison.status = 'completed'
        ) AS "completedComparisons",
        (
          SELECT COUNT(*)::integer
          FROM execution_events ev
          JOIN base replay_base ON replay_base.id = ev.execution_id
          WHERE ev.type = 'replay.completed'
        ) AS "reproducibilityChecks",
        (
          SELECT COUNT(*)::integer
          FROM execution_events ev
          JOIN base replay_base ON replay_base.id = ev.execution_id
          WHERE ev.type = 'replay.completed'
            AND ev.data->>'outcomeMatches' = 'true'
        ) AS "exactOutputMatches"
      FROM base b
      LEFT JOIN usage_by_execution u ON u.execution_id = b.id
    `),
    db.execute<TrendRow>(sql`
      WITH buckets AS (
        SELECT bucket_start
        FROM generate_series(
          ${new Date(range.from)}::timestamptz,
          (${new Date(range.to)}::timestamptz - ${bucketInterval}::interval),
          ${bucketInterval}::interval
        ) bucket_start
      ),
      aggregate AS (
        SELECT
          date_bin(
            ${bucketInterval}::interval,
            e.created_at,
            ${new Date(range.from)}::timestamptz
          ) AS bucket_start,
          COUNT(*)::integer AS total,
          COUNT(*) FILTER (
            WHERE e.status IN ('succeeded', 'degraded', 'failed', 'cancelled')
          )::integer AS terminal,
          COUNT(*) FILTER (WHERE e.status = 'succeeded')::integer AS succeeded,
          COUNT(*) FILTER (WHERE e.status = 'degraded')::integer AS degraded,
          COUNT(*) FILTER (WHERE e.status = 'failed')::integer AS failed
        FROM executions e
        WHERE e.tenant_id = ${tenantId}
          AND e.created_at >= ${new Date(range.from)}
          AND e.created_at < ${new Date(range.to)}
        GROUP BY bucket_start
      )
      SELECT
        buckets.bucket_start AS "bucketFrom",
        LEAST(
          buckets.bucket_start + ${bucketInterval}::interval,
          ${new Date(range.to)}::timestamptz
        ) AS "bucketTo",
        COALESCE(aggregate.total, 0)::integer AS "total",
        COALESCE(aggregate.terminal, 0)::integer AS "terminal",
        COALESCE(aggregate.succeeded, 0)::integer AS "succeeded",
        COALESCE(aggregate.degraded, 0)::integer AS "degraded",
        COALESCE(aggregate.failed, 0)::integer AS "failed"
      FROM buckets
      LEFT JOIN aggregate USING (bucket_start)
      ORDER BY buckets.bucket_start
    `),
  ]);
  const aggregate = aggregateResult.rows[0] ?? emptyAggregate();
  const terminal = numberValue(aggregate.terminal);
  const succeeded = numberValue(aggregate.succeeded);
  const degraded = numberValue(aggregate.degraded);
  const failed = numberValue(aggregate.failed);
  return {
    range,
    population: {
      total: numberValue(aggregate.total),
      terminal,
      inFlight: numberValue(aggregate.queued) + numberValue(aggregate.running),
      queued: numberValue(aggregate.queued),
      running: numberValue(aggregate.running),
      cancelled: numberValue(aggregate.cancelled),
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
      retryRecovered: numberValue(aggregate.retryRecovered),
      fallbackUsed: numberValue(aggregate.fallbackUsed),
      latencyBudgetExceeded: numberValue(aggregate.latencyBudgetExceeded),
      structuredOutputRejected: numberValue(aggregate.structuredOutputRejected),
      providerOutcomeAmbiguous: numberValue(aggregate.providerOutcomeAmbiguous),
      rateLimitFailures: numberValue(aggregate.rateLimitFailures),
      timeoutFailures: numberValue(aggregate.timeoutFailures),
      providerUnavailableFailures: numberValue(aggregate.providerUnavailableFailures),
    },
    latency: {
      sampleSize: numberValue(aggregate.latencySampleSize),
      p50Ms: nullableNumber(aggregate.p50Ms),
      p95Ms: nullableNumber(aggregate.p95Ms),
    },
    usage: {
      executionCoverage: numberValue(aggregate.executionCoverage),
      costCoverage: numberValue(aggregate.costCoverage),
      inputTokens: numberValue(aggregate.inputTokens),
      outputTokens: numberValue(aggregate.outputTokens),
      estimatedCostUsd: numberValue(aggregate.estimatedCostUsd),
    },
    comparisons: {
      completed: numberValue(aggregate.completedComparisons),
      reproducibilityChecks: numberValue(aggregate.reproducibilityChecks),
      exactOutputMatches: numberValue(aggregate.exactOutputMatches),
    },
    trend: trendResult.rows.map(toTrendBucket),
  };
}
