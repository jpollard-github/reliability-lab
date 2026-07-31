/**
 * Owns saved-case atomic command boundaries: current state, append-only notes/evidence,
 * and their metadata-only timeline events.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseNote,
  InvestigationCaseTimelineEvent,
  TenantId,
} from "@reliability-lab/contracts";
import type { ReliabilityDatabase } from "../database/database.js";
import {
  investigationCaseEvidence,
  investigationCaseEvents,
  investigationCaseNotes,
  investigationCases,
} from "../schema/investigation-cases.js";
import {
  caseInsert,
  eventInsert,
  evidenceFromReference,
  referenceFromEvidence,
} from "./case-row-mappers.js";

export async function createInvestigationCase(
  db: ReliabilityDatabase,
  investigationCase: InvestigationCase,
  event: InvestigationCaseTimelineEvent,
) {
  await db.transaction(async (transaction) => {
    await transaction.insert(investigationCases).values(caseInsert(investigationCase));
    await transaction
      .insert(investigationCaseEvents)
      .values(eventInsert(investigationCase.tenantId, event));
  });
}

export async function updateInvestigationCase(
  db: ReliabilityDatabase,
  investigationCase: InvestigationCase,
  events: InvestigationCaseTimelineEvent[],
) {
  await db.transaction(async (transaction) => {
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

export async function addInvestigationCaseNote(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  note: InvestigationCaseNote,
  event: InvestigationCaseTimelineEvent,
) {
  await db.transaction(async (transaction) => {
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

export async function addInvestigationCaseEvidence(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  evidence: InvestigationCaseEvidence,
  identity: string,
  events: InvestigationCaseTimelineEvent[],
  eventsWhenAlreadyPresent: InvestigationCaseTimelineEvent[] = [],
) {
  return db.transaction(async (transaction) => {
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
      const newEvents: InvestigationCaseTimelineEvent[] = [];
      for (const event of eventsWhenAlreadyPresent) {
        if (event.type !== "case.comparison_link_recovered") {
          newEvents.push(event);
          continue;
        }
        const [latest] = await transaction
          .select({ type: investigationCaseEvents.type })
          .from(investigationCaseEvents)
          .where(
            and(
              eq(investigationCaseEvents.tenantId, tenantId),
              eq(investigationCaseEvents.caseId, evidence.caseId),
              inArray(investigationCaseEvents.type, [
                "case.comparison_link_failed",
                "case.comparison_link_recovered",
              ]),
              sql`${investigationCaseEvents.metadata} ->> 'experimentId' = ${String(
                event.metadata.experimentId,
              )}`,
            ),
          )
          .orderBy(desc(investigationCaseEvents.ordinal))
          .limit(1);
        if (latest?.type !== "case.comparison_link_recovered") newEvents.push(event);
      }
      if (newEvents.length) {
        await transaction
          .insert(investigationCaseEvents)
          .values(newEvents.map((event) => eventInsert(tenantId, event)));
        await transaction
          .update(investigationCases)
          .set({
            updatedAt: new Date(newEvents.at(-1)!.occurredAt),
          })
          .where(
            and(
              eq(investigationCases.tenantId, tenantId),
              eq(investigationCases.id, evidence.caseId),
            ),
          );
      }
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
    await transaction
      .insert(investigationCaseEvents)
      .values(events.map((event) => eventInsert(tenantId, event)));
    await transaction
      .update(investigationCases)
      .set({ updatedAt: new Date(evidence.addedAt) })
      .where(
        and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, evidence.caseId)),
      );
    return { evidence, added: true };
  });
}

export async function appendInvestigationCaseEvent(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  event: InvestigationCaseTimelineEvent,
) {
  await db.transaction(async (transaction) => {
    const [existing] = await transaction
      .select({ id: investigationCases.id })
      .from(investigationCases)
      .where(
        and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, event.caseId)),
      )
      .limit(1);
    if (!existing) throw new Error("Investigation case not found");
    await transaction.insert(investigationCaseEvents).values(eventInsert(tenantId, event));
    await transaction
      .update(investigationCases)
      .set({ updatedAt: new Date(event.occurredAt) })
      .where(
        and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, event.caseId)),
      );
  });
}

export async function removeInvestigationCaseEvidence(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  caseId: string,
  evidenceId: string,
  event: InvestigationCaseTimelineEvent,
) {
  return db.transaction(async (transaction) => {
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
