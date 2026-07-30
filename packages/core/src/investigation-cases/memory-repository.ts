import type {
  InvestigationCase,
  InvestigationCaseDetail,
  InvestigationCaseEvidence,
  InvestigationCaseNote,
  InvestigationCaseSummary,
  InvestigationCaseTimelineEvent,
  TenantId,
} from "@reliability-lab/contracts";
import { decodeCaseCursor, encodeCaseCursor } from "./cursor.js";
import { InvestigationCaseNotFoundError } from "./errors.js";
import { evidenceCounts } from "./evidence.js";
import type { InvestigationCaseListQuery, InvestigationCaseRepository } from "./repository.js";
import { savedScopeToWorkbenchUrl } from "./saved-scope.js";

const CASE_PAGE_DEFAULT = 25;

/**
 * Process-local saved-case repository with tenant isolation and stable cursor semantics.
 * It preserves case behavior for tests and in-process mode without claiming durability.
 */
export class MemoryInvestigationCaseRepository implements InvestigationCaseRepository {
  readonly #records = new Map<
    string,
    {
      investigationCase: InvestigationCase;
      notes: InvestigationCaseNote[];
      evidence: Array<{ value: InvestigationCaseEvidence; identity: string }>;
      timeline: InvestigationCaseTimelineEvent[];
    }
  >();

  async create(investigationCase: InvestigationCase, event: InvestigationCaseTimelineEvent) {
    this.#records.set(investigationCase.caseId, {
      investigationCase: structuredClone(investigationCase),
      notes: [],
      evidence: [],
      timeline: [structuredClone(event)],
    });
  }

  async get(tenantId: TenantId, caseId: string) {
    const record = this.#records.get(caseId);
    if (record?.investigationCase.tenantId !== tenantId) return null;
    return detailFromRecord(record);
  }

  async list(tenantId: TenantId, query: InvestigationCaseListQuery) {
    const cursor = query.cursor ? decodeCaseCursor(query.cursor) : undefined;
    const normalized = query.query?.trim().toLowerCase();
    const filtered = [...this.#records.values()]
      .filter((record) => record.investigationCase.tenantId === tenantId)
      .filter(
        (record) =>
          !query.statuses?.length || query.statuses.includes(record.investigationCase.status),
      )
      .filter(
        (record) => !query.importance || record.investigationCase.importance === query.importance,
      )
      .filter(
        (record) =>
          !normalized ||
          record.investigationCase.title.toLowerCase().includes(normalized) ||
          record.investigationCase.question.toLowerCase().includes(normalized),
      )
      .filter(
        (record) =>
          !query.executionId ||
          record.evidence.some(
            (item) =>
              item.value.type === "execution" && item.value.executionId === query.executionId,
          ),
      )
      .sort(
        (left, right) =>
          right.investigationCase.updatedAt.localeCompare(left.investigationCase.updatedAt) ||
          right.investigationCase.caseId.localeCompare(left.investigationCase.caseId),
      );
    const afterCursor = cursor
      ? filtered.filter(({ investigationCase }) => {
          if (investigationCase.updatedAt < cursor.updatedAt) return true;
          if (investigationCase.updatedAt > cursor.updatedAt) return false;
          return investigationCase.caseId < cursor.caseId;
        })
      : filtered;
    const limit = query.limit ?? CASE_PAGE_DEFAULT;
    const page = afterCursor.slice(0, limit + 1);
    const visible = page.slice(0, limit);
    const last = visible.at(-1)?.investigationCase;
    return {
      data: visible.map(summaryFromRecord),
      total: filtered.length,
      ...(page.length > limit && last
        ? { nextCursor: encodeCaseCursor(last.updatedAt, last.caseId) }
        : {}),
    };
  }

  async update(investigationCase: InvestigationCase, events: InvestigationCaseTimelineEvent[]) {
    const record = this.#records.get(investigationCase.caseId);
    if (!record || record.investigationCase.tenantId !== investigationCase.tenantId)
      throw new InvestigationCaseNotFoundError();
    record.investigationCase = structuredClone(investigationCase);
    record.timeline.push(...structuredClone(events));
  }

  async addNote(
    tenantId: TenantId,
    note: InvestigationCaseNote,
    event: InvestigationCaseTimelineEvent,
  ) {
    const record = this.#tenantRecord(tenantId, note.caseId);
    record.notes.push(structuredClone(note));
    record.timeline.push(structuredClone(event));
    record.investigationCase.updatedAt = note.createdAt;
  }

  async addEvidence(
    tenantId: TenantId,
    evidence: InvestigationCaseEvidence,
    identity: string,
    events: InvestigationCaseTimelineEvent[],
  ) {
    const record = this.#tenantRecord(tenantId, evidence.caseId);
    const existing = record.evidence.find((item) => item.identity === identity);
    if (existing) return { evidence: structuredClone(existing.value), added: false };
    record.evidence.push({ value: structuredClone(evidence), identity });
    record.timeline.push(...structuredClone(events));
    record.investigationCase.updatedAt = evidence.addedAt;
    return { evidence: structuredClone(evidence), added: true };
  }

  async removeEvidence(
    tenantId: TenantId,
    caseId: string,
    evidenceId: string,
    event: InvestigationCaseTimelineEvent,
  ) {
    const record = this.#tenantRecord(tenantId, caseId);
    const index = record.evidence.findIndex((item) => item.value.evidenceId === evidenceId);
    if (index < 0) return false;
    record.evidence.splice(index, 1);
    record.timeline.push(structuredClone(event));
    record.investigationCase.updatedAt = event.occurredAt;
    return true;
  }

  async appendEvent(tenantId: TenantId, event: InvestigationCaseTimelineEvent) {
    const record = this.#tenantRecord(tenantId, event.caseId);
    record.timeline.push(structuredClone(event));
    record.investigationCase.updatedAt = event.occurredAt;
  }

  #tenantRecord(tenantId: TenantId, caseId: string) {
    const record = this.#records.get(caseId);
    if (record?.investigationCase.tenantId !== tenantId) throw new InvestigationCaseNotFoundError();
    return record;
  }
}

function detailFromRecord(record: {
  investigationCase: InvestigationCase;
  notes: InvestigationCaseNote[];
  evidence: Array<{ value: InvestigationCaseEvidence }>;
  timeline: InvestigationCaseTimelineEvent[];
}): InvestigationCaseDetail {
  return {
    case: structuredClone(record.investigationCase),
    notes: structuredClone(record.notes),
    evidence: record.evidence.map((item) => structuredClone(item.value)),
    timeline: structuredClone(record.timeline),
    links: {
      self: `/v1/investigation-cases/${record.investigationCase.caseId}`,
      savedWorkbench: savedScopeToWorkbenchUrl(record.investigationCase.savedScope),
    },
  };
}

function summaryFromRecord(record: {
  investigationCase: InvestigationCase;
  evidence: Array<{ value: InvestigationCaseEvidence }>;
}): InvestigationCaseSummary {
  return {
    case: structuredClone(record.investigationCase),
    evidenceCounts: evidenceCounts(record.evidence.map((item) => item.value)),
  };
}
