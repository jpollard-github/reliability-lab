/**
 * Owns stable saved-case pagination and its cursor-independent total count.
 * Ordering remains updatedAt DESC, caseId DESC within one tenant.
 */
import { sql, type SQL } from "drizzle-orm";
import type { TenantId } from "@reliability-lab/contracts";
import {
  decodeCaseCursor,
  encodeCaseCursor,
  type InvestigationCaseListQuery,
} from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import { caseSummaryFromRow, type CaseListRow } from "./case-row-mappers.js";

type CaseCountRow = { total: number | string };

export async function listInvestigationCases(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  query: InvestigationCaseListQuery,
) {
  const conditions = listConditions(tenantId, query);
  const cursor = query.cursor ? decodeCaseCursor(query.cursor) : undefined;
  const cursorCondition = cursor
    ? sql`AND (
        c.updated_at < ${new Date(cursor.updatedAt)}
        OR (c.updated_at = ${new Date(cursor.updatedAt)} AND c.id < ${cursor.caseId})
      )`
    : sql``;
  const limit = query.limit ?? 25;
  const [pageResult, countResult] = await Promise.all([
    db.execute<CaseListRow>(sql`
      SELECT
        c.id AS "caseId",
        c.tenant_id AS "tenantId",
        c.schema_version AS "schemaVersion",
        c.title,
        c.question,
        c.status,
        c.importance,
        c.saved_scope AS "savedScope",
        c.finding,
        c.resolution,
        c.created_at AS "createdAt",
        c.updated_at AS "updatedAt",
        c.resolved_at AS "resolvedAt",
        COUNT(e.id) FILTER (WHERE e.type = 'execution')::integer AS "executionCount",
        COUNT(e.id) FILTER (WHERE e.type = 'comparison')::integer AS "comparisonCount",
        COUNT(e.id) FILTER (
          WHERE e.type = 'provider_observation'
        )::integer AS "providerObservationCount"
      FROM investigation_cases c
      LEFT JOIN investigation_case_evidence e
        ON e.tenant_id = c.tenant_id AND e.case_id = c.id
      WHERE ${sql.join(conditions, sql` AND `)}
        ${cursorCondition}
      GROUP BY c.id
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ${limit + 1}
    `),
    db.execute<CaseCountRow>(sql`
      SELECT COUNT(*)::integer AS total
      FROM investigation_cases c
      WHERE ${sql.join(conditions, sql` AND `)}
    `),
  ]);
  const hasNext = pageResult.rows.length > limit;
  const visible = pageResult.rows.slice(0, limit);
  const data = visible.map(caseSummaryFromRow);
  const last = data.at(-1)?.case;
  return {
    data,
    total: numberValue(countResult.rows[0]?.total),
    ...(hasNext && last ? { nextCursor: encodeCaseCursor(last.updatedAt, last.caseId) } : {}),
  };
}

function listConditions(tenantId: TenantId, query: InvestigationCaseListQuery): SQL[] {
  const conditions: SQL[] = [sql`c.tenant_id = ${tenantId}`];
  if (query.statuses?.length) {
    conditions.push(
      sql`c.status IN (${sql.join(
        query.statuses.map((status) => sql`${status}`),
        sql`, `,
      )})`,
    );
  }
  if (query.importance) conditions.push(sql`c.importance = ${query.importance}`);
  if (query.query) {
    const pattern = `%${escapeLike(query.query.trim().toLowerCase())}%`;
    conditions.push(
      sql`(
        LOWER(c.title) LIKE ${pattern} ESCAPE '\'
        OR LOWER(c.question) LIKE ${pattern} ESCAPE '\'
      )`,
    );
  }
  if (query.executionId) {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM investigation_case_evidence linked
      WHERE linked.tenant_id = c.tenant_id
        AND linked.case_id = c.id
        AND linked.type = 'execution'
        AND linked.identity = ${`execution:${query.executionId}`}
    )`);
  }
  return conditions;
}

function numberValue(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
