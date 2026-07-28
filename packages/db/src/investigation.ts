import { sql, type SQL } from "drizzle-orm";
import type {
  ExecutionStatus,
  ExecutionSummary,
  ExecutionSummaryPage,
  InvestigationExecutionQuery,
  InvestigationProviderQuery,
  InvestigationRange,
  ProviderErrorCategory,
  ProviderObservation,
  ProviderObservationPage,
  ReliabilitySummary,
  ReliabilityTrendBucket,
  TenantId,
} from "@reliability-lab/contracts";
import {
  decodeExecutionCursor,
  encodeExecutionCursor,
  type InvestigationReadRepository,
} from "@reliability-lab/core";
import type { ReliabilityDatabase } from "./index.js";

type SearchRow = {
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
  totalCount: number | string;
};

type AggregateRow = {
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
  providerCapacityFailures: number | string;
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

type TrendRow = {
  bucketFrom: Date | string;
  bucketTo: Date | string;
  total: number | string;
  terminal: number | string;
  succeeded: number | string;
  degraded: number | string;
  failed: number | string;
};

type ProviderRow = {
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

export class PostgresInvestigationReadRepository implements InvestigationReadRepository {
  readonly #db: ReliabilityDatabase;
  readonly #onQuery:
    ((operation: "search" | "summary" | "trend" | "providers") => void) | undefined;

  constructor(
    db: ReliabilityDatabase,
    options: {
      onQuery?: (operation: "search" | "summary" | "trend" | "providers") => void;
    } = {},
  ) {
    this.#db = db;
    this.#onQuery = options.onQuery;
  }

  async searchExecutions(
    tenantId: TenantId,
    query: InvestigationExecutionQuery,
  ): Promise<ExecutionSummaryPage> {
    const conditions = executionConditions(tenantId, query);
    const cursor = query.cursor ? decodeExecutionCursor(query.cursor) : undefined;
    const cursorCondition = cursor
      ? sql`AND (
          m.created_at < ${new Date(cursor.createdAt)}
          OR (m.created_at = ${new Date(cursor.createdAt)} AND m.id < ${cursor.executionId})
        )`
      : sql``;
    this.#onQuery?.("search");
    const result = await this.#db.execute<SearchRow>(sql`
      WITH matched AS (
        SELECT e.*
        FROM executions e
        WHERE ${sql.join(conditions, sql` AND `)}
      ),
      page AS (
        SELECT m.*
        FROM matched m
        WHERE TRUE ${cursorCondition}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT ${query.limit + 1}
      )
      SELECT
        p.id AS "executionId",
        p.status AS "status",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",
        p.duration_ms AS "durationMs",
        p.provider AS "initialProvider",
        p.model AS "initialModel",
        final_attempt.data->>'provider' AS "finalProvider",
        final_attempt.data->>'model' AS "finalModel",
        p.trace_id AS "traceId",
        COALESCE(attempt_counts.attempt_count, 0) AS "attemptCount",
        GREATEST(COALESCE(attempt_counts.attempt_count, 0) - 1, 0) AS "retryCount",
        (
          p.status IN ('succeeded', 'degraded')
          AND (
            EXISTS (
              SELECT 1 FROM execution_events ev
              WHERE ev.execution_id = p.id AND ev.type = 'retry.scheduled'
            )
            OR (
              COALESCE(attempt_counts.attempt_count, 0) > 1
              AND EXISTS (
                SELECT 1 FROM execution_attempts a
                WHERE a.execution_id = p.id AND a.data->>'status' <> 'succeeded'
              )
            )
          )
        ) AS "retryRecovered",
        (
          p.status IN ('succeeded', 'degraded')
          AND EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = p.id AND ev.type = 'fallback.selected'
          )
        ) AS "fallbackUsed",
        (
          p.error->>'code' = 'latency_budget_exceeded'
          OR EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = p.id
              AND ev.type = 'budget.exceeded'
              AND ev.data->>'budget' = 'latency'
          )
        ) AS "latencyBudgetExceeded",
        EXISTS (
          SELECT 1 FROM execution_events ev
          WHERE ev.execution_id = p.id AND ev.type = 'structured_output.rejected'
        ) AS "structuredOutputRejected",
        (
          p.error->>'code' = 'provider_call_outcome_unknown'
          OR EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = p.id AND ev.type = 'attempt.outcome_ambiguous'
          )
        ) AS "providerOutcomeAmbiguous",
        p.replay_of_execution_id AS "replayOfExecutionId",
        p.error->>'category' AS "errorCategory",
        p.error->>'code' AS "errorCode",
        (
          SELECT COUNT(*)::integer
          FROM comparison_experiments comparison
          WHERE comparison.tenant_id = p.tenant_id
            AND (
              comparison.original_execution_id = p.id
              OR comparison.variant_execution_id = p.id
            )
        ) AS "comparisonCount",
        (SELECT COUNT(*)::integer FROM matched) AS "totalCount"
      FROM page p
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::integer AS attempt_count
        FROM execution_attempts a
        WHERE a.execution_id = p.id
      ) attempt_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT a.data
        FROM execution_attempts a
        WHERE a.execution_id = p.id
        ORDER BY a.attempt_number DESC
        LIMIT 1
      ) final_attempt ON TRUE
      ORDER BY p.created_at DESC, p.id DESC
    `);
    const rows = result.rows;
    const hasNext = rows.length > query.limit;
    const visibleRows = rows.slice(0, query.limit);
    const data = visibleRows.map(toExecutionSummary);
    const last = data.at(-1);
    return {
      range: query.range,
      data,
      total: numberValue(rows[0]?.totalCount),
      ...(hasNext && last
        ? { nextCursor: encodeExecutionCursor(last.createdAt, last.executionId) }
        : {}),
    };
  }

  async summarize(tenantId: TenantId, range: InvestigationRange): Promise<ReliabilitySummary> {
    const bucketInterval =
      new Date(range.to).getTime() - new Date(range.from).getTime() <= 24 * 60 * 60 * 1_000
        ? "1 hour"
        : "1 day";
    this.#onQuery?.("summary");
    this.#onQuery?.("trend");
    const [aggregateResult, trendResult] = await Promise.all([
      this.#db.execute<AggregateRow>(sql`
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
          )::integer AS "providerCapacityFailures",
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
      this.#db.execute<TrendRow>(sql`
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
        providerCapacityFailures: numberValue(aggregate.providerCapacityFailures),
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

  async observeProviders(
    tenantId: TenantId,
    query: InvestigationProviderQuery,
  ): Promise<ProviderObservationPage> {
    const routeConditions: SQL[] = [
      sql`e.tenant_id = ${tenantId}`,
      sql`e.created_at >= ${new Date(query.range.from)}`,
      sql`e.created_at < ${new Date(query.range.to)}`,
    ];
    if (query.providers?.length)
      routeConditions.push(inValues(sql`a.data->>'provider'`, query.providers));
    if (query.models?.length) routeConditions.push(inValues(sql`a.data->>'model'`, query.models));
    this.#onQuery?.("providers");
    const result = await this.#db.execute<ProviderRow>(sql`
      SELECT
        a.data->>'provider' AS "provider",
        a.data->>'model' AS "model",
        COUNT(*)::integer AS "attemptCount",
        COUNT(DISTINCT a.execution_id)::integer AS "executionCount",
        COUNT(*) FILTER (WHERE a.data->>'status' <> 'running')::integer AS "terminalAttemptCount",
        COUNT(*) FILTER (WHERE a.data->>'status' = 'succeeded')::integer AS "succeededAttempts",
        COUNT(*) FILTER (WHERE a.data->>'status' = 'failed')::integer AS "failedAttempts",
        COUNT(*) FILTER (WHERE a.data->>'status' = 'timed_out')::integer AS "timedOutAttempts",
        COUNT(*) FILTER (WHERE a.data->>'status' = 'rejected')::integer AS "rejectedAttempts",
        COUNT(*) FILTER (WHERE a.data->>'status' = 'running')::integer AS "runningAttempts",
        COUNT(NULLIF(a.data->>'durationMs', ''))::integer AS "latencySampleSize",
        percentile_disc(0.5) WITHIN GROUP (
          ORDER BY NULLIF(a.data->>'durationMs', '')::numeric
        ) FILTER (WHERE a.data->>'durationMs' IS NOT NULL) AS "p50LatencyMs",
        percentile_disc(0.95) WITHIN GROUP (
          ORDER BY NULLIF(a.data->>'durationMs', '')::numeric
        ) FILTER (WHERE a.data->>'durationMs' IS NOT NULL) AS "p95LatencyMs",
        COUNT(*) FILTER (
          WHERE a.data #>> '{error,category}' = 'rate_limit'
        )::integer AS "rateLimitedAttempts",
        COUNT(*) FILTER (
          WHERE a.data #>> '{error,category}' = 'provider_unavailable'
        )::integer AS "providerUnavailableAttempts",
        COUNT(*) FILTER (
          WHERE a.data->'error' IS NOT NULL
        )::integer AS "providerErrors",
        COUNT(*) FILTER (
          WHERE a.data #>> '{validation,valid}' = 'false'
        )::integer AS "structuredOutputRejections",
        COUNT(DISTINCT a.execution_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = a.execution_id
              AND ev.type = 'fallback.selected'
              AND ev.data->>'provider' = a.data->>'provider'
              AND ev.data->>'model' = a.data->>'model'
          )
        )::integer AS "fallbackSelectedToRoute"
      FROM execution_attempts a
      JOIN executions e ON e.id = a.execution_id
      WHERE ${sql.join(routeConditions, sql` AND `)}
      GROUP BY a.data->>'provider', a.data->>'model'
      ORDER BY COUNT(*) DESC, a.data->>'provider', a.data->>'model'
      LIMIT ${query.limit}
    `);
    return {
      range: query.range,
      data: result.rows.map(toProviderObservation),
    };
  }
}

function executionConditions(tenantId: TenantId, query: InvestigationExecutionQuery): SQL[] {
  const conditions: SQL[] = [
    sql`e.tenant_id = ${tenantId}`,
    sql`e.created_at >= ${new Date(query.range.from)}`,
    sql`e.created_at < ${new Date(query.range.to)}`,
  ];
  if (query.query) {
    const prefix = `${escapeLike(query.query.trim().toLowerCase())}%`;
    conditions.push(
      sql`(LOWER(e.id) LIKE ${prefix} ESCAPE '\' OR LOWER(e.trace_id) LIKE ${prefix} ESCAPE '\')`,
    );
  }
  if (query.statuses?.length) conditions.push(inValues(sql`e.status`, query.statuses));
  if (query.providers?.length || query.models?.length) {
    const attemptConditions = [sql`a.execution_id = e.id`];
    const initialConditions: SQL[] = [];
    if (query.providers?.length) {
      attemptConditions.push(inValues(sql`a.data->>'provider'`, query.providers));
      initialConditions.push(inValues(sql`e.provider`, query.providers));
    }
    if (query.models?.length) {
      attemptConditions.push(inValues(sql`a.data->>'model'`, query.models));
      initialConditions.push(inValues(sql`e.model`, query.models));
    }
    conditions.push(sql`(
      EXISTS (
        SELECT 1 FROM execution_attempts a
        WHERE ${sql.join(attemptConditions, sql` AND `)}
      )
      OR (
        NOT EXISTS (SELECT 1 FROM execution_attempts a WHERE a.execution_id = e.id)
        AND ${sql.join(initialConditions, sql` AND `)}
      )
    )`);
  }
  if (query.errorCategory) conditions.push(sql`e.error->>'category' = ${query.errorCategory}`);
  if (query.errorCode) conditions.push(sql`e.error->>'code' = ${query.errorCode}`);
  if (query.signal) conditions.push(signalCondition(query.signal));
  return conditions;
}

function signalCondition(signal: InvestigationExecutionQuery["signal"]): SQL {
  switch (signal) {
    case "retry_recovered":
      return sql`(
        e.status IN ('succeeded', 'degraded')
        AND (
          EXISTS (
            SELECT 1 FROM execution_events ev
            WHERE ev.execution_id = e.id AND ev.type = 'retry.scheduled'
          )
          OR (
            (SELECT COUNT(*) FROM execution_attempts a WHERE a.execution_id = e.id) > 1
            AND EXISTS (
              SELECT 1 FROM execution_attempts a
              WHERE a.execution_id = e.id AND a.data->>'status' <> 'succeeded'
            )
          )
        )
      )`;
    case "fallback_used":
      return sql`(
        e.status IN ('succeeded', 'degraded')
        AND EXISTS (
          SELECT 1 FROM execution_events ev
          WHERE ev.execution_id = e.id AND ev.type = 'fallback.selected'
        )
      )`;
    case "latency_budget_exceeded":
      return sql`(
        e.error->>'code' = 'latency_budget_exceeded'
        OR EXISTS (
          SELECT 1 FROM execution_events ev
          WHERE ev.execution_id = e.id
            AND ev.type = 'budget.exceeded'
            AND ev.data->>'budget' = 'latency'
        )
      )`;
    case "structured_output_rejected":
      return sql`EXISTS (
        SELECT 1 FROM execution_events ev
        WHERE ev.execution_id = e.id AND ev.type = 'structured_output.rejected'
      )`;
    case "provider_outcome_ambiguous":
      return sql`(
        e.error->>'code' = 'provider_call_outcome_unknown'
        OR EXISTS (
          SELECT 1 FROM execution_events ev
          WHERE ev.execution_id = e.id AND ev.type = 'attempt.outcome_ambiguous'
        )
      )`;
    case "replay_derived":
      return sql`e.replay_of_execution_id IS NOT NULL`;
    default:
      return sql`TRUE`;
  }
}

function inValues(column: SQL, values: string[]): SQL {
  return sql`${column} IN (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

function toExecutionSummary(row: SearchRow): ExecutionSummary {
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

function toTrendBucket(row: TrendRow): ReliabilityTrendBucket {
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

function toProviderObservation(row: ProviderRow): ProviderObservation {
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

function emptyAggregate(): AggregateRow {
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
    providerCapacityFailures: 0,
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

function numberValue(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function nullableNumber(value: number | string | null): number | null {
  return value === null ? null : Number(value);
}

function isoValue(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
