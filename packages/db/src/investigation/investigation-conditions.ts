/** Owns tenant, time, filter, and evidence-signal SQL predicates for execution search. */
import { sql, type SQL } from "drizzle-orm";
import type { InvestigationExecutionQuery, TenantId } from "@reliability-lab/contracts";
import { escapeLike, inValues } from "./sql-values.js";

export function executionConditions(tenantId: TenantId, query: InvestigationExecutionQuery): SQL[] {
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
