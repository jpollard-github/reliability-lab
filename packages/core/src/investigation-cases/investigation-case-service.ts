import { randomUUID } from "node:crypto";
import type {
  AddInvestigationCaseNoteBody,
  CreateInvestigationCaseBody,
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceInput,
  InvestigationCaseEventType,
  InvestigationCaseNote,
  InvestigationCaseTimelineEvent,
  TenantId,
  UpdateInvestigationCaseBody,
} from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository } from "../comparison/repository.js";
import type { ExecutionRepository } from "../execution/ports.js";
import {
  InvestigationCaseConclusionError,
  InvestigationCaseInputError,
  InvestigationCaseNotFoundError,
} from "./errors.js";
import { evidenceIdentity, evidenceUrl } from "./evidence.js";
import type {
  InvestigationCaseListQuery,
  InvestigationCaseRepository,
  InvestigationCaseServiceOptions,
} from "./repository.js";
import { canonicalizeSavedScope } from "./saved-scope.js";
import { exactRange, plainText } from "./validation.js";

const CASE_PAGE_DEFAULT = 25;
const CASE_PAGE_MAX = 100;
const CASE_EVIDENCE_MAX = 50;

/**
 * Coordinates saved-case state, append-only notes, typed evidence, and metadata events.
 * It does not calculate Workbench aggregates or copy authoritative execution evidence.
 */
export class InvestigationCaseService {
  readonly #cases: InvestigationCaseRepository;
  readonly #executions: ExecutionRepository;
  readonly #comparisons: ComparisonExperimentRepository;
  readonly #now: () => Date;
  readonly #id: () => string;

  constructor(options: InvestigationCaseServiceOptions) {
    this.#cases = options.cases;
    this.#executions = options.executions;
    this.#comparisons = options.comparisons;
    this.#now = options.now ?? (() => new Date());
    this.#id = options.id ?? randomUUID;
  }

  async create(tenantId: TenantId, input: CreateInvestigationCaseBody) {
    const occurredAt = this.#now().toISOString();
    const investigationCase: InvestigationCase = {
      schemaVersion: 1,
      caseId: this.#id(),
      tenantId,
      title: plainText(input.title, "title", 1, 200),
      question: plainText(input.question, "question", 1, 2_000),
      status: "open",
      savedScope: canonicalizeSavedScope(input.savedScope),
      createdAt: occurredAt,
      updatedAt: occurredAt,
      ...(input.importance ? { importance: input.importance } : {}),
    };
    await this.#cases.create(
      investigationCase,
      this.#event(investigationCase.caseId, "case.created", occurredAt, {
        status: "open",
      }),
    );
    return this.get(tenantId, investigationCase.caseId);
  }

  async get(tenantId: TenantId, caseId: string) {
    const detail = await this.#cases.get(tenantId, caseId);
    if (!detail) throw new InvestigationCaseNotFoundError();
    return detail;
  }

  async list(tenantId: TenantId, query: InvestigationCaseListQuery = {}) {
    const limit = query.limit ?? CASE_PAGE_DEFAULT;
    if (!Number.isInteger(limit) || limit < 1 || limit > CASE_PAGE_MAX) {
      throw new InvestigationCaseInputError("Case page limit must be between 1 and 100");
    }
    return this.#cases.list(tenantId, {
      ...query,
      limit,
      ...(query.query ? { query: plainText(query.query, "query", 1, 256) } : {}),
      ...(query.executionId
        ? { executionId: plainText(query.executionId, "executionId", 1, 256) }
        : {}),
    });
  }

  async update(tenantId: TenantId, caseId: string, input: UpdateInvestigationCaseBody) {
    const detail = await this.get(tenantId, caseId);
    const current = detail.case;
    const occurredAt = this.#now().toISOString();
    const next: InvestigationCase = structuredClone(current);
    next.updatedAt = occurredAt;
    if (input.title !== undefined) next.title = plainText(input.title, "title", 1, 200);
    if (input.question !== undefined)
      next.question = plainText(input.question, "question", 1, 2_000);
    if (input.status !== undefined) next.status = input.status;
    if (input.importance === null) delete next.importance;
    else if (input.importance !== undefined) next.importance = input.importance;
    if (input.finding === null || input.finding?.trim() === "") delete next.finding;
    else if (input.finding !== undefined)
      next.finding = plainText(input.finding, "finding", 0, 10_000);
    if (input.resolution === null || input.resolution?.trim() === "") delete next.resolution;
    else if (input.resolution !== undefined)
      next.resolution = plainText(input.resolution, "resolution", 0, 10_000);
    if (next.status === "resolved" && (!next.finding?.trim() || !next.resolution?.trim())) {
      throw new InvestigationCaseConclusionError(
        "Resolved cases require a non-empty current finding and resolution",
      );
    }
    if (input.status === "resolved" && current.status !== "resolved") next.resolvedAt = occurredAt;
    if (input.status && input.status !== "resolved") delete next.resolvedAt;
    const changedFields = (
      ["title", "question", "status", "importance", "finding", "resolution"] as const
    ).filter((field) => input[field] !== undefined);
    const events: InvestigationCaseTimelineEvent[] = [
      this.#event(caseId, "case.updated", occurredAt, {
        fields: changedFields.join(","),
      }),
    ];
    if (input.status !== undefined && input.status !== current.status) {
      events.push(
        this.#event(caseId, "case.status_changed", occurredAt, {
          from: current.status,
          to: input.status,
        }),
      );
    }
    if (input.finding !== undefined) {
      events.push(
        this.#event(caseId, "case.finding_updated", occurredAt, {
          present: Boolean(next.finding),
        }),
      );
    }
    if (input.resolution !== undefined) {
      events.push(
        this.#event(caseId, "case.resolution_updated", occurredAt, {
          present: Boolean(next.resolution),
        }),
      );
    }
    await this.#cases.update(next, events);
    return this.get(tenantId, caseId);
  }

  async addNote(tenantId: TenantId, caseId: string, input: AddInvestigationCaseNoteBody) {
    await this.get(tenantId, caseId);
    const createdAt = this.#now().toISOString();
    const note: InvestigationCaseNote = {
      noteId: this.#id(),
      caseId,
      body: plainText(input.body, "note body", 1, 5_000),
      createdAt,
    };
    await this.#cases.addNote(
      tenantId,
      note,
      this.#event(caseId, "case.note_added", createdAt, { noteId: note.noteId }),
    );
    return note;
  }

  async addEvidence(tenantId: TenantId, caseId: string, input: InvestigationCaseEvidenceInput) {
    const detail = await this.get(tenantId, caseId);
    const canonical = await this.#canonicalEvidence(tenantId, input);
    const identity = evidenceIdentity(canonical);
    const alreadyLinked = detail.evidence.some((item) => evidenceIdentity(item) === identity);
    if (!alreadyLinked && detail.evidence.length >= CASE_EVIDENCE_MAX) {
      throw new InvestigationCaseInputError(
        `An investigation case may link at most ${CASE_EVIDENCE_MAX} evidence references`,
      );
    }
    const addedAt = this.#now().toISOString();
    const evidence: InvestigationCaseEvidence = {
      evidenceId: this.#id(),
      caseId,
      addedAt,
      url: evidenceUrl(canonical),
      ...canonical,
    };
    return this.#cases.addEvidence(
      tenantId,
      evidence,
      identity,
      this.#event(caseId, "case.evidence_added", addedAt, {
        evidenceId: evidence.evidenceId,
        evidenceType: evidence.type,
      }),
    );
  }

  async removeEvidence(tenantId: TenantId, caseId: string, evidenceId: string) {
    await this.get(tenantId, caseId);
    const occurredAt = this.#now().toISOString();
    const removed = await this.#cases.removeEvidence(
      tenantId,
      caseId,
      evidenceId,
      this.#event(caseId, "case.evidence_removed", occurredAt, { evidenceId }),
    );
    if (!removed) throw new InvestigationCaseNotFoundError();
  }

  async #canonicalEvidence(
    tenantId: TenantId,
    input: InvestigationCaseEvidenceInput,
  ): Promise<InvestigationCaseEvidenceInput> {
    if (input.type === "execution") {
      const executionId = plainText(input.executionId, "executionId", 1, 256);
      if (!(await this.#executions.findById(tenantId, executionId))) {
        throw new InvestigationCaseNotFoundError();
      }
      return { type: "execution", executionId };
    }
    if (input.type === "comparison") {
      const experimentId = plainText(input.experimentId, "experimentId", 1, 256);
      if (!(await this.#comparisons.findById(tenantId, experimentId))) {
        throw new InvestigationCaseNotFoundError();
      }
      return { type: "comparison", experimentId };
    }
    return {
      type: "provider_observation",
      provider: plainText(input.provider, "provider", 1, 128),
      model: plainText(input.model, "model", 1, 256),
      range: exactRange(input.range),
    };
  }

  #event(
    caseId: string,
    type: InvestigationCaseEventType,
    occurredAt: string,
    metadata: InvestigationCaseTimelineEvent["metadata"],
  ): InvestigationCaseTimelineEvent {
    return { eventId: this.#id(), caseId, type, occurredAt, metadata };
  }
}
