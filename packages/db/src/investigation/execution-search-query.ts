/**
 * Owns the bounded execution page query and its fixed total-count companion query.
 * Total count remains independent of the cursor so empty cursor pages stay truthful.
 */
import { sql } from "drizzle-orm";
import type {
  ExecutionSummaryPage,
  InvestigationExecutionQuery,
  TenantId,
} from "@reliability-lab/contracts";
import { decodeExecutionCursor, encodeExecutionCursor } from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import { executionConditions } from "./investigation-conditions.js";
import type { CountRow, SearchRow } from "./investigation-row-types.js";
import { toExecutionSummary } from "./investigation-row-mappers.js";
import { numberValue } from "./sql-values.js";

export async function searchExecutions(
  db: ReliabilityDatabase,
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
  const [result, countResult] = await Promise.all([
    db.execute<SearchRow>(sql`
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
        ) AS "comparisonCount"
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
    `),
    db.execute<CountRow>(sql`
      SELECT COUNT(*)::integer AS "totalCount"
      FROM executions e
      WHERE ${sql.join(conditions, sql` AND `)}
    `),
  ]);
  const rows = result.rows;
  const hasNext = rows.length > query.limit;
  const visibleRows = rows.slice(0, query.limit);
  const data = visibleRows.map(toExecutionSummary);
  const last = data.at(-1);
  return {
    range: query.range,
    data,
    total: numberValue(countResult.rows[0]?.totalCount),
    ...(hasNext && last
      ? { nextCursor: encodeExecutionCursor(last.createdAt, last.executionId) }
      : {}),
  };
}
