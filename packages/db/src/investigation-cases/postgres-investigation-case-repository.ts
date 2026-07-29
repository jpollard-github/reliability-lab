/**
 * Thin saved-case PostgreSQL repository.
 * Named query and transaction modules own hydration, pagination, and atomic commands.
 */
import type {
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseNote,
  InvestigationCaseTimelineEvent,
  TenantId,
} from "@reliability-lab/contracts";
import type {
  InvestigationCaseListQuery,
  InvestigationCaseRepository,
} from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import {
  addInvestigationCaseEvidence,
  addInvestigationCaseNote,
  createInvestigationCase,
  removeInvestigationCaseEvidence,
  updateInvestigationCase,
} from "./case-command-transactions.js";
import { getInvestigationCase } from "./case-detail-query.js";
import { listInvestigationCases } from "./case-list-query.js";

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

  create(investigationCase: InvestigationCase, event: InvestigationCaseTimelineEvent) {
    return createInvestigationCase(this.#db, investigationCase, event);
  }

  get(tenantId: TenantId, caseId: string) {
    return getInvestigationCase(this.#db, tenantId, caseId);
  }

  list(tenantId: TenantId, query: InvestigationCaseListQuery) {
    this.#onQuery?.("list");
    this.#onQuery?.("count");
    return listInvestigationCases(this.#db, tenantId, query);
  }

  update(investigationCase: InvestigationCase, events: InvestigationCaseTimelineEvent[]) {
    return updateInvestigationCase(this.#db, investigationCase, events);
  }

  addNote(tenantId: TenantId, note: InvestigationCaseNote, event: InvestigationCaseTimelineEvent) {
    return addInvestigationCaseNote(this.#db, tenantId, note, event);
  }

  addEvidence(
    tenantId: TenantId,
    evidence: InvestigationCaseEvidence,
    identity: string,
    event: InvestigationCaseTimelineEvent,
  ) {
    return addInvestigationCaseEvidence(this.#db, tenantId, evidence, identity, event);
  }

  removeEvidence(
    tenantId: TenantId,
    caseId: string,
    evidenceId: string,
    event: InvestigationCaseTimelineEvent,
  ) {
    return removeInvestigationCaseEvidence(this.#db, tenantId, caseId, evidenceId, event);
  }
}
