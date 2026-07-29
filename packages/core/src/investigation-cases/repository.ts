import type {
  InvestigationCase,
  InvestigationCaseDetail,
  InvestigationCaseEvidence,
  InvestigationCaseImportance,
  InvestigationCaseNote,
  InvestigationCasePage,
  InvestigationCaseStatus,
  InvestigationCaseTimelineEvent,
  TenantId,
} from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository } from "../comparison/repository.js";
import type { ExecutionRepository } from "../execution/ports.js";

/**
 * Saved-case persistence port and bounded list query.
 * Execution and comparison evidence ownership is validated through their own ports.
 */
export interface InvestigationCaseListQuery {
  limit?: number;
  cursor?: string;
  statuses?: InvestigationCaseStatus[];
  importance?: InvestigationCaseImportance;
  query?: string;
  executionId?: string;
}

export interface InvestigationCaseRepository {
  create(
    investigationCase: InvestigationCase,
    event: InvestigationCaseTimelineEvent,
  ): Promise<void>;
  get(tenantId: TenantId, caseId: string): Promise<InvestigationCaseDetail | null>;
  list(tenantId: TenantId, query: InvestigationCaseListQuery): Promise<InvestigationCasePage>;
  update(
    investigationCase: InvestigationCase,
    events: InvestigationCaseTimelineEvent[],
  ): Promise<void>;
  addNote(
    tenantId: TenantId,
    note: InvestigationCaseNote,
    event: InvestigationCaseTimelineEvent,
  ): Promise<void>;
  addEvidence(
    tenantId: TenantId,
    evidence: InvestigationCaseEvidence,
    identity: string,
    event: InvestigationCaseTimelineEvent,
  ): Promise<{ evidence: InvestigationCaseEvidence; added: boolean }>;
  removeEvidence(
    tenantId: TenantId,
    caseId: string,
    evidenceId: string,
    event: InvestigationCaseTimelineEvent,
  ): Promise<boolean>;
}

export interface InvestigationCaseServiceOptions {
  cases: InvestigationCaseRepository;
  executions: ExecutionRepository;
  comparisons: ComparisonExperimentRepository;
  now?: () => Date;
  id?: () => string;
}
