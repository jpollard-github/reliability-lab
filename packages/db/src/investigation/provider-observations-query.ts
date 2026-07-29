/**
 * Owns the single attempt-level provider/model observation query.
 * It reports observed evidence, not a universal provider-health score.
 */
import { sql, type SQL } from "drizzle-orm";
import type {
  InvestigationProviderQuery,
  ProviderObservationPage,
  TenantId,
} from "@reliability-lab/contracts";
import type { ReliabilityDatabase } from "../database/database.js";
import type { ProviderRow } from "./investigation-row-types.js";
import { toProviderObservation } from "./investigation-row-mappers.js";
import { inValues } from "./sql-values.js";

export async function observeProviders(
  db: ReliabilityDatabase,
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
  const result = await db.execute<ProviderRow>(sql`
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
