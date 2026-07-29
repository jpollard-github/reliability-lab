/** Maps saved-case rows, evidence references, and timeline events without copying payload data. */
import type {
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceInput,
  InvestigationCaseImportance,
  InvestigationCaseStatus,
  InvestigationCaseSummary,
  InvestigationCaseTimelineEvent,
  SavedInvestigationScope,
  TenantId,
} from "@reliability-lab/contracts";
import { evidenceUrl } from "@reliability-lab/core";
import type { investigationCaseEvents, investigationCases } from "../schema/investigation-cases.js";

export type CaseListRow = {
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

export function caseInsert(
  investigationCase: InvestigationCase,
): typeof investigationCases.$inferInsert {
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

export function caseFromRow(row: typeof investigationCases.$inferSelect): InvestigationCase {
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

export function caseSummaryFromRow(row: CaseListRow): InvestigationCaseSummary {
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

export function eventInsert(
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

export function evidenceFromReference(input: {
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

export function referenceFromEvidence(
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
