/** Hydrates one tenant-scoped saved case from current state, notes, evidence, and timeline rows. */
import { and, asc, eq } from "drizzle-orm";
import type { InvestigationCaseDetail, TenantId } from "@reliability-lab/contracts";
import { savedScopeToWorkbenchUrl } from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import {
  investigationCaseEvidence,
  investigationCaseEvents,
  investigationCaseNotes,
  investigationCases,
} from "../schema/investigation-cases.js";
import { caseFromRow, evidenceFromReference } from "./case-row-mappers.js";

export async function getInvestigationCase(
  db: ReliabilityDatabase,
  tenantId: TenantId,
  caseId: string,
): Promise<InvestigationCaseDetail | null> {
  const [row] = await db
    .select()
    .from(investigationCases)
    .where(and(eq(investigationCases.tenantId, tenantId), eq(investigationCases.id, caseId)))
    .limit(1);
  if (!row) return null;
  const [noteRows, evidenceRows, eventRows] = await Promise.all([
    db
      .select()
      .from(investigationCaseNotes)
      .where(
        and(
          eq(investigationCaseNotes.tenantId, tenantId),
          eq(investigationCaseNotes.caseId, caseId),
        ),
      )
      .orderBy(asc(investigationCaseNotes.createdAt), asc(investigationCaseNotes.id)),
    db
      .select()
      .from(investigationCaseEvidence)
      .where(
        and(
          eq(investigationCaseEvidence.tenantId, tenantId),
          eq(investigationCaseEvidence.caseId, caseId),
        ),
      )
      .orderBy(asc(investigationCaseEvidence.addedAt), asc(investigationCaseEvidence.id)),
    db
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
