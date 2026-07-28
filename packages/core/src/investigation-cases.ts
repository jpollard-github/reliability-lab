import { randomUUID } from "node:crypto";
import type {
  AddInvestigationCaseNoteBody,
  ComparisonExperiment,
  CreateInvestigationCaseBody,
  InvestigationCase,
  InvestigationCaseDetail,
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceCounts,
  InvestigationCaseEvidenceInput,
  InvestigationCaseEventType,
  InvestigationCaseImportance,
  InvestigationCaseNote,
  InvestigationCasePage,
  InvestigationCaseStatus,
  InvestigationCaseSummary,
  InvestigationCaseTimelineEvent,
  InvestigationRange,
  SavedInvestigationScope,
  TenantId,
  UpdateInvestigationCaseBody,
} from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository, ExecutionRepository } from "./index.js";
import { resolveInvestigationRange } from "./investigation.js";

const CASE_PAGE_DEFAULT = 25;
const CASE_PAGE_MAX = 100;

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

export class InvestigationCaseInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestigationCaseInputError";
  }
}

export class InvestigationCaseNotFoundError extends Error {
  constructor() {
    super("Investigation case not found");
    this.name = "InvestigationCaseNotFoundError";
  }
}

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
    await this.get(tenantId, caseId);
    const canonical = await this.#canonicalEvidence(tenantId, input);
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
      evidenceIdentity(canonical),
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

export function canonicalizeSavedScope(input: SavedInvestigationScope): SavedInvestigationScope {
  const query = input.query?.trim();
  const providers = canonicalArray(input.providers);
  const models = canonicalArray(input.models);
  const statuses = canonicalArray(input.statuses);
  const errorCode = input.errorCode?.trim();
  return {
    range: exactRange(input.range),
    ...(query ? { query } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(providers.length ? { providers } : {}),
    ...(models.length ? { models } : {}),
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function savedScopeFromWorkbenchState(
  input: Record<string, string | string[] | undefined>,
  range: InvestigationRange,
): SavedInvestigationScope {
  const values = (key: string) => {
    const value = input[key];
    return (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(","));
  };
  return canonicalizeSavedScope({
    range,
    ...(values("q")[0] ? { query: values("q")[0] } : {}),
    ...(values("status").length
      ? {
          statuses: values("status") as NonNullable<SavedInvestigationScope["statuses"]>,
        }
      : {}),
    ...(values("provider").length ? { providers: values("provider") } : {}),
    ...(values("model").length ? { models: values("model") } : {}),
    ...(values("errorCategory")[0]
      ? {
          errorCategory: values("errorCategory")[0] as NonNullable<
            SavedInvestigationScope["errorCategory"]
          >,
        }
      : {}),
    ...(values("errorCode")[0] ? { errorCode: values("errorCode")[0] } : {}),
    ...(values("signal")[0]
      ? {
          signal: values("signal")[0] as NonNullable<SavedInvestigationScope["signal"]>,
        }
      : {}),
  });
}

export function savedScopeToWorkbenchUrl(scope: SavedInvestigationScope): string {
  const canonical = canonicalizeSavedScope(scope);
  const params = new URLSearchParams({
    from: canonical.range.from,
    to: canonical.range.to,
  });
  if (canonical.query) params.set("q", canonical.query);
  for (const status of canonical.statuses ?? []) params.append("status", status);
  for (const provider of canonical.providers ?? []) params.append("provider", provider);
  for (const model of canonical.models ?? []) params.append("model", model);
  if (canonical.errorCategory) params.set("errorCategory", canonical.errorCategory);
  if (canonical.errorCode) params.set("errorCode", canonical.errorCode);
  if (canonical.signal) params.set("signal", canonical.signal);
  return `/investigations?${params.toString()}#execution-explorer`;
}

export function evidenceIdentity(input: InvestigationCaseEvidenceInput): string {
  if (input.type === "execution") return `execution:${input.executionId}`;
  if (input.type === "comparison") return `comparison:${input.experimentId}`;
  return JSON.stringify([
    "provider_observation",
    input.provider,
    input.model,
    input.range.from,
    input.range.to,
  ]);
}

export function evidenceUrl(input: InvestigationCaseEvidenceInput): string {
  if (input.type === "execution") return `/executions/${encodeURIComponent(input.executionId)}`;
  if (input.type === "comparison") return `/comparisons/${encodeURIComponent(input.experimentId)}`;
  const params = new URLSearchParams({
    from: input.range.from,
    to: input.range.to,
    provider: input.provider,
    model: input.model,
  });
  return `/investigations?${params.toString()}#provider-observations`;
}

export function encodeCaseCursor(updatedAt: string, caseId: string): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt, caseId }), "utf8").toString("base64url");
}

export function decodeCaseCursor(cursor: string): { updatedAt: string; caseId: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      v?: unknown;
      updatedAt?: unknown;
      caseId?: unknown;
    };
    if (
      parsed.v !== 1 ||
      typeof parsed.updatedAt !== "string" ||
      typeof parsed.caseId !== "string" ||
      !parsed.caseId ||
      !Number.isFinite(new Date(parsed.updatedAt).getTime())
    )
      throw new Error("invalid cursor");
    return { updatedAt: new Date(parsed.updatedAt).toISOString(), caseId: parsed.caseId };
  } catch {
    throw new InvestigationCaseInputError("The case cursor is invalid");
  }
}

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
    event: InvestigationCaseTimelineEvent,
  ) {
    const record = this.#tenantRecord(tenantId, evidence.caseId);
    const existing = record.evidence.find((item) => item.identity === identity);
    if (existing) return { evidence: structuredClone(existing.value), added: false };
    record.evidence.push({ value: structuredClone(evidence), identity });
    record.timeline.push(structuredClone(event));
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

export function evidenceCounts(
  evidence: InvestigationCaseEvidence[],
): InvestigationCaseEvidenceCounts {
  return {
    executions: evidence.filter((item) => item.type === "execution").length,
    comparisons: evidence.filter((item) => item.type === "comparison").length,
    providerObservations: evidence.filter((item) => item.type === "provider_observation").length,
  };
}

function canonicalArray<T extends string>(values: T[] | undefined): T[] {
  return [...new Set((values ?? []).map((value) => value.trim() as T).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function exactRange(range: InvestigationRange): InvestigationRange {
  if (!range?.from || !range.to)
    throw new InvestigationCaseInputError("Saved scope requires exact from and to instants");
  try {
    return resolveInvestigationRange({ from: range.from, to: range.to });
  } catch (error) {
    throw new InvestigationCaseInputError(
      error instanceof Error ? error.message : "Saved scope range is invalid",
    );
  }
}

function plainText(value: string, label: string, minimum: number, maximum: number): string {
  const trimmed = value.trim();
  if (trimmed.length < minimum || trimmed.length > maximum)
    throw new InvestigationCaseInputError(
      `${label} must be between ${minimum} and ${maximum} characters`,
    );
  if (/<\/?[a-z][^>]*>/iu.test(trimmed))
    throw new InvestigationCaseInputError(`${label} must be plain text without HTML`);
  return trimmed;
}

export type { ComparisonExperiment };
