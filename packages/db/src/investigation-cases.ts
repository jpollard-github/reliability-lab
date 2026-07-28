import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import type {
  InvestigationCase,
  InvestigationCaseDetail,
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceCounts,
  InvestigationCaseEvidenceInput,
  InvestigationCaseImportance,
  InvestigationCaseNote,
  InvestigationCaseStatus,
  InvestigationCaseSummary,
  InvestigationCaseTimelineEvent,
  SavedInvestigationScope,
  TenantId,
} from "@reliability-lab/contracts";
import {
  decodeCaseCursor,
  encodeCaseCursor,
  evidenceUrl,
  savedScopeToWorkbenchUrl,
  type InvestigationCaseListQuery,
  type InvestigationCaseRepository,
} from "@reliability-lab/core";
import type { ReliabilityDatabase } from "./index.js";
import {
  investigationCaseEvidence,
  investigationCaseEvents,
  investigationCaseNotes,
  investigationCases,
} from "./schema.js";

type CaseListRow = {
  caseId: string;
  tenantId: string;
  schemaVersion: number;
  title: string;
  question: string;
  status: InvestigationCaseStatus;
  importance: InvestigationCaseImportance | null;
  savedScope: SavedInvestigationScope;
  finding: string | null;
  resolution: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  resolvedAt: Date | string | null;
  executionCount: number | string;
  comparisonCount: number | string;
  providerObservationCount: number | string;
};

type CaseCountRow = { total: number | string };

export class PostgresInvestigationCaseRepository implements InvestigationCaseRepository {
  readonly #db: ReliabilityDatabase;
  readonly #onQuery: ((operation: "list" | "count") => void) | undefined;

  constructor(
    db: ReliabilityDatabase,
    options: { onQuery?: (operation: "list" | "count") => void } = {},
  ) {
    this.#db = db;
    this.#onQuery = options.onQuery;
  }

  async create(investigationCase: InvestigationCase, event: InvestigationCaseTimelineEvent) {
    await this.#db.transaction(async (transaction) => {
      await transaction.insert(investigationCases).values(caseInsert(investigationCase));
      await transaction
        .insert(investigationCaseEvents)
        .values(eventInsert(investigationCase.tenantId, event));
    });
  }

  async get(tenantId: TenantId, caseId: string): Promise<InvestigationCaseDetail | null> {
    const [row] = await this.#db
      .select()
      .from(investigationCases)
      .where(and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, caseId)))
      .limit(1);
    if (!row) return null;
    const [noteRows, evidenceRows, eventRows] = await Promise.all([
      this.#db
        .select()
        .from(investigationCaseNotes)
        .where(
          and(
            eq(investigationCaseNotes.tenantId, tenantId),
            eq(investigationCaseNotes.caseId, caseId),
          ),
        )
        .orderBy(asc(investigationCaseNotes.createdAt), asc(investigationCaseNotes.id)),
      this.#db
        .select()
        .from(investigationCaseEvidence)
        .where(
          and(
            eq(investigationCaseEvidence.tenantId, tenantId),
            eq(investigationCaseEvidence.caseId, caseId),
          ),
        )
        .orderBy(asc(investigationCaseEvidence.addedAt), asc(investigationCaseEvidence.id)),
      this.#db
        .select()
        .from(investigationCaseEvents)
        .where(
          and(
            eq(investigationCaseEvents.tenantId, tenantId),
            eq(investigationCaseEvents.caseId, caseId),
          ),
        )
        .orderBy(asc(investigationCaseEvents.ordinal)),
    ]);
    const investigationCase = caseFromRow(row);
    return {
      case: investigationCase,
      notes: noteRows.map((note) => ({
        noteId: note.id,
        caseId: note.caseId,
        body: note.body,
        createdAt: note.createdAt.toISOString(),
      })),
      evidence: evidenceRows.map((evidence) =>
        evidenceFromReference({
          evidenceId: evidence.id,
          caseId: evidence.caseId,
          addedAt: evidence.addedAt.toISOString(),
          reference: evidence.reference,
        }),
      ),
      timeline: eventRows.map((event) => ({
        eventId: event.id,
        caseId: event.caseId,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        metadata: event.metadata,
      })),
      links: {
        self: `/v1/investigation-cases/${caseId}`,
        savedWorkbench: savedScopeToWorkbenchUrl(investigationCase.savedScope),
      },
    };
  }

  async list(tenantId: TenantId, query: InvestigationCaseListQuery) {
    const conditions = listConditions(tenantId, query);
    const cursor = query.cursor ? decodeCaseCursor(query.cursor) : undefined;
    const cursorCondition = cursor
      ? sql`AND (
          c.updated_at < ${new Date(cursor.updatedAt)}
          OR (c.updated_at = ${new Date(cursor.updatedAt)} AND c.id < ${cursor.caseId})
        )`
      : sql``;
    const limit = query.limit ?? 25;
    this.#onQuery?.("list");
    this.#onQuery?.("count");
    const [pageResult, countResult] = await Promise.all([
      this.#db.execute<CaseListRow>(sql`
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
      this.#db.execute<CaseCountRow>(sql`
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

  async update(investigationCase: InvestigationCase, events: InvestigationCaseTimelineEvent[]) {
    await this.#db.transaction(async (transaction) => {
      const updated = await transaction
        .update(investigationCases)
        .set({
          title: investigationCase.title,
          question: investigationCase.question,
          status: investigationCase.status,
          importance: investigationCase.importance ?? null,
          finding: investigationCase.finding ?? null,
          resolution: investigationCase.resolution ?? null,
          updatedAt: new Date(investigationCase.updatedAt),
          resolvedAt: investigationCase.resolvedAt ? new Date(investigationCase.resolvedAt) : null,
        })
        .where(
          and(
            eq(investigationCases.tenantId, investigationCase.tenantId),
            eq(investigationCases.id, investigationCase.caseId),
          ),
        )
        .returning({ id: investigationCases.id });
      if (!updated.length) throw new Error("Investigation case not found");
      if (events.length) {
        await transaction
          .insert(investigationCaseEvents)
          .values(events.map((event) => eventInsert(investigationCase.tenantId, event)));
      }
    });
  }

  async addNote(
    tenantId: TenantId,
    note: InvestigationCaseNote,
    event: InvestigationCaseTimelineEvent,
  ) {
    await this.#db.transaction(async (transaction) => {
      await transaction.insert(investigationCaseNotes).values({
        id: note.noteId,
        caseId: note.caseId,
        tenantId,
        body: note.body,
        createdAt: new Date(note.createdAt),
      });
      await transaction.insert(investigationCaseEvents).values(eventInsert(tenantId, event));
      await transaction
        .update(investigationCases)
        .set({ updatedAt: new Date(note.createdAt) })
        .where(
          and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, note.caseId)),
        );
    });
  }

  async addEvidence(
    tenantId: TenantId,
    evidence: InvestigationCaseEvidence,
    identity: string,
    event: InvestigationCaseTimelineEvent,
  ) {
    return this.#db.transaction(async (transaction) => {
      const reference = referenceFromEvidence(evidence);
      const inserted = await transaction
        .insert(investigationCaseEvidence)
        .values({
          id: evidence.evidenceId,
          caseId: evidence.caseId,
          tenantId,
          type: evidence.type,
          identity,
          reference,
          addedAt: new Date(evidence.addedAt),
        })
        .onConflictDoNothing()
        .returning({ id: investigationCaseEvidence.id });
      if (!inserted.length) {
        const [existing] = await transaction
          .select()
          .from(investigationCaseEvidence)
          .where(
            and(
              eq(investigationCaseEvidence.tenantId, tenantId),
              eq(investigationCaseEvidence.caseId, evidence.caseId),
              eq(investigationCaseEvidence.identity, identity),
            ),
          )
          .limit(1);
        if (!existing) throw new Error("Investigation evidence conflict could not be resolved");
        return {
          evidence: evidenceFromReference({
            evidenceId: existing.id,
            caseId: existing.caseId,
            addedAt: existing.addedAt.toISOString(),
            reference: existing.reference,
          }),
          added: false,
        };
      }
      await transaction.insert(investigationCaseEvents).values(eventInsert(tenantId, event));
      await transaction
        .update(investigationCases)
        .set({ updatedAt: new Date(evidence.addedAt) })
        .where(
          and(
            eq(investigationCases.tenantId, tenantId),
            eq(investigationCases.id, evidence.caseId),
          ),
        );
      return { evidence, added: true };
    });
  }

  async removeEvidence(
    tenantId: TenantId,
    caseId: string,
    evidenceId: string,
    event: InvestigationCaseTimelineEvent,
  ) {
    return this.#db.transaction(async (transaction) => {
      const removed = await transaction
        .delete(investigationCaseEvidence)
        .where(
          and(
            eq(investigationCaseEvidence.tenantId, tenantId),
            eq(investigationCaseEvidence.caseId, caseId),
            eq(investigationCaseEvidence.id, evidenceId),
          ),
        )
        .returning({ id: investigationCaseEvidence.id });
      if (!removed.length) return false;
      await transaction.insert(investigationCaseEvents).values(eventInsert(tenantId, event));
      await transaction
        .update(investigationCases)
        .set({ updatedAt: new Date(event.occurredAt) })
        .where(and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, caseId)));
      return true;
    });
  }
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

function caseInsert(investigationCase: InvestigationCase): typeof investigationCases.$inferInsert {
  return {
    id: investigationCase.caseId,
    tenantId: investigationCase.tenantId,
    schemaVersion: investigationCase.schemaVersion,
    title: investigationCase.title,
    question: investigationCase.question,
    status: investigationCase.status,
    importance: investigationCase.importance,
    savedScope: investigationCase.savedScope,
    finding: investigationCase.finding,
    resolution: investigationCase.resolution,
    createdAt: new Date(investigationCase.createdAt),
    updatedAt: new Date(investigationCase.updatedAt),
    resolvedAt: investigationCase.resolvedAt ? new Date(investigationCase.resolvedAt) : undefined,
  };
}

function caseFromRow(row: typeof investigationCases.$inferSelect): InvestigationCase {
  return {
    schemaVersion: 1,
    caseId: row.id,
    tenantId: row.tenantId,
    title: row.title,
    question: row.question,
    status: row.status,
    savedScope: row.savedScope,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.importance ? { importance: row.importance } : {}),
    ...(row.finding ? { finding: row.finding } : {}),
    ...(row.resolution ? { resolution: row.resolution } : {}),
    ...(row.resolvedAt ? { resolvedAt: row.resolvedAt.toISOString() } : {}),
  };
}

function caseSummaryFromRow(row: CaseListRow): InvestigationCaseSummary {
  return {
    case: {
      schemaVersion: 1,
      caseId: row.caseId,
      tenantId: row.tenantId,
      title: row.title,
      question: row.question,
      status: row.status,
      savedScope: row.savedScope,
      createdAt: isoValue(row.createdAt),
      updatedAt: isoValue(row.updatedAt),
      ...(row.importance ? { importance: row.importance } : {}),
      ...(row.finding ? { finding: row.finding } : {}),
      ...(row.resolution ? { resolution: row.resolution } : {}),
      ...(row.resolvedAt ? { resolvedAt: isoValue(row.resolvedAt) } : {}),
    },
    evidenceCounts: {
      executions: numberValue(row.executionCount),
      comparisons: numberValue(row.comparisonCount),
      providerObservations: numberValue(row.providerObservationCount),
    },
  };
}

function eventInsert(
  tenantId: TenantId,
  event: InvestigationCaseTimelineEvent,
): typeof investigationCaseEvents.$inferInsert {
  return {
    id: event.eventId,
    caseId: event.caseId,
    tenantId,
    type: event.type,
    occurredAt: new Date(event.occurredAt),
    metadata: event.metadata,
  };
}

function evidenceFromReference(input: {
  evidenceId: string;
  caseId: string;
  addedAt: string;
  reference: InvestigationCaseEvidenceInput;
}): InvestigationCaseEvidence {
  return {
    evidenceId: input.evidenceId,
    caseId: input.caseId,
    addedAt: input.addedAt,
    url: evidenceUrl(input.reference),
    ...input.reference,
  };
}

function referenceFromEvidence(
  evidence: InvestigationCaseEvidence,
): InvestigationCaseEvidenceInput {
  if (evidence.type === "execution")
    return { type: "execution", executionId: evidence.executionId };
  if (evidence.type === "comparison")
    return { type: "comparison", experimentId: evidence.experimentId };
  return {
    type: "provider_observation",
    provider: evidence.provider,
    model: evidence.model,
    range: evidence.range,
  };
}

function numberValue(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

function isoValue(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export type { InvestigationCaseEvidenceCounts, InvestigationCaseSummary };
