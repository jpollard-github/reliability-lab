import type {
  AvailableCaseEvidenceReviewItem,
  CaseComparisonEvidenceSummary,
  CaseEvidenceReviewItem,
  ComparisonConditionReview,
  ConclusionReadiness,
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseEvidenceInput,
  InvestigationCaseReview,
  TenantId,
} from "@reliability-lab/contracts";
import { projectComparison } from "../comparison/comparison-projection.js";
import type { ComparisonExperimentRepository } from "../comparison/repository.js";
import type { ExecutionRepository } from "../execution/ports.js";
import { projectExecutionSummary } from "../investigation/signals.js";
import type { InvestigationReadRepository } from "../investigation/read-repository.js";
import type { ReplayCapsuleStore } from "../replay/replay-store.js";
import { InvestigationCaseNotFoundError } from "./errors.js";
import type { InvestigationCaseRepository } from "./repository.js";

const EVIDENCE_READ_CONCURRENCY = 5;

export interface InvestigationCaseReviewDiagnostic {
  caseId: string;
  evidenceId: string;
  evidenceType: InvestigationCaseEvidence["type"];
  operation:
    "read_execution_evidence" | "read_comparison_evidence" | "read_provider_observation_evidence";
  errorName: string;
}

/**
 * Resolves linked case references from their authoritative ports into a bounded review projection.
 * Reads run in fixed-size batches; item order always matches the case's persisted evidence order.
 */
export class InvestigationCaseReviewService {
  readonly #cases: InvestigationCaseRepository;
  readonly #executions: ExecutionRepository;
  readonly #comparisons: ComparisonExperimentRepository;
  readonly #investigations: InvestigationReadRepository;
  readonly #replayCapsules: ReplayCapsuleStore;
  readonly #now: () => Date;
  readonly #onDiagnostic: ((diagnostic: InvestigationCaseReviewDiagnostic) => void) | undefined;

  constructor(options: {
    cases: InvestigationCaseRepository;
    executions: ExecutionRepository;
    comparisons: ComparisonExperimentRepository;
    investigations: InvestigationReadRepository;
    replayCapsules: ReplayCapsuleStore;
    now?: () => Date;
    onDiagnostic?: (diagnostic: InvestigationCaseReviewDiagnostic) => void;
  }) {
    this.#cases = options.cases;
    this.#executions = options.executions;
    this.#comparisons = options.comparisons;
    this.#investigations = options.investigations;
    this.#replayCapsules = options.replayCapsules;
    this.#now = options.now ?? (() => new Date());
    this.#onDiagnostic = options.onDiagnostic;
  }

  async get(tenantId: TenantId, caseId: string): Promise<InvestigationCaseReview> {
    const detail = await this.#cases.get(tenantId, caseId);
    if (!detail) throw new InvestigationCaseNotFoundError();
    const evidence: CaseEvidenceReviewItem[] = [];
    for (let index = 0; index < detail.evidence.length; index += EVIDENCE_READ_CONCURRENCY) {
      const batch = detail.evidence.slice(index, index + EVIDENCE_READ_CONCURRENCY);
      evidence.push(...(await Promise.all(batch.map((item) => this.#resolve(tenantId, item)))));
    }
    return {
      schemaVersion: 1,
      generatedAt: this.#now().toISOString(),
      case: detail.case,
      scope: detail.case.savedScope,
      noteCount: detail.notes.length,
      evidence,
      readiness: projectConclusionReadiness(detail.case, evidence),
      links: {
        self: `/v1/investigation-cases/${encodeURIComponent(caseId)}/review`,
        packet: `/v1/investigation-cases/${encodeURIComponent(caseId)}/review-packet`,
        savedWorkbench: detail.links.savedWorkbench,
      },
    };
  }

  async #resolve(
    tenantId: TenantId,
    evidence: InvestigationCaseEvidence,
  ): Promise<CaseEvidenceReviewItem> {
    try {
      if (evidence.type === "execution") return await this.#execution(tenantId, evidence);
      if (evidence.type === "comparison") return await this.#comparison(tenantId, evidence);
      return await this.#providerObservation(tenantId, evidence);
    } catch (error) {
      this.#diagnose(evidence, error);
      return unavailable(evidence, "current_read_unavailable");
    }
  }

  #diagnose(evidence: InvestigationCaseEvidence, error: unknown): void {
    if (!this.#onDiagnostic) return;
    const operations = {
      execution: "read_execution_evidence",
      comparison: "read_comparison_evidence",
      provider_observation: "read_provider_observation_evidence",
    } as const;
    try {
      this.#onDiagnostic({
        caseId: evidence.caseId,
        evidenceId: evidence.evidenceId,
        evidenceType: evidence.type,
        operation: operations[evidence.type],
        errorName: constrainedErrorName(error),
      });
    } catch {
      // Diagnostics must never replace the explicit user-facing unavailable state.
    }
  }

  async #execution(
    tenantId: TenantId,
    evidence: Extract<InvestigationCaseEvidence, { type: "execution" }>,
  ): Promise<CaseEvidenceReviewItem> {
    const execution = await this.#executions.findById(tenantId, evidence.executionId);
    if (!execution) return unavailable(evidence, "authoritative_evidence_not_found");
    if (execution.schemaVersion !== 1) {
      return unavailable(evidence, "unsupported_historical_schema");
    }
    const replayCapability =
      execution.replayCapability.state === "retention_disabled"
        ? execution.replayCapability
        : await this.#replayCapsules.inspect(tenantId, execution.executionId);
    const item: AvailableCaseEvidenceReviewItem = {
      ...base(evidence),
      type: "execution",
      availability: "available",
      reference: { type: "execution", executionId: evidence.executionId },
      summary: {
        ...projectExecutionSummary(execution),
        replayCapability,
        policy: structuredClone(execution.policy),
        budget: structuredClone(execution.budget),
      },
    };
    return item;
  }

  async #comparison(
    tenantId: TenantId,
    evidence: Extract<InvestigationCaseEvidence, { type: "comparison" }>,
  ): Promise<CaseEvidenceReviewItem> {
    const experiment = await this.#comparisons.findById(tenantId, evidence.experimentId);
    if (!experiment) return unavailable(evidence, "authoritative_evidence_not_found");
    if (experiment.schemaVersion !== 1) {
      return unavailable(evidence, "unsupported_historical_schema");
    }
    const original = await this.#executions.findById(tenantId, experiment.originalExecutionId);
    if (!original) return unavailable(evidence, "authoritative_evidence_not_found");
    const variant = experiment.variantExecutionId
      ? await this.#executions.findById(tenantId, experiment.variantExecutionId)
      : null;
    const projection = projectComparison(original, variant ?? undefined);
    const summary: CaseComparisonEvidenceSummary = {
      experimentId: experiment.experimentId,
      status: experiment.status,
      originalExecutionId: experiment.originalExecutionId,
      originalStatus: original.status,
      ...(experiment.variantExecutionId
        ? { variantExecutionId: experiment.variantExecutionId }
        : {}),
      ...(variant ? { variantStatus: variant.status } : {}),
      requestedVariation: structuredClone(experiment.requestedVariation),
      resolvedVariant: structuredClone(experiment.resolvedVariant),
      conditions: comparisonConditions(experiment.requestedVariation),
      summary: projection.summary,
      dimensions: structuredClone(projection.dimensions),
      createdAt: experiment.createdAt,
      updatedAt: experiment.updatedAt,
      ...(experiment.unavailableReason ? { unavailableReason: experiment.unavailableReason } : {}),
    };
    const item: AvailableCaseEvidenceReviewItem = {
      ...base(evidence),
      type: "comparison",
      availability: "available",
      reference: { type: "comparison", experimentId: evidence.experimentId },
      summary,
    };
    return item;
  }

  async #providerObservation(
    tenantId: TenantId,
    evidence: Extract<InvestigationCaseEvidence, { type: "provider_observation" }>,
  ): Promise<CaseEvidenceReviewItem> {
    const page = await this.#investigations.observeProviders(tenantId, {
      range: evidence.range,
      limit: 1,
      providers: [evidence.provider],
      models: [evidence.model],
    });
    const observation = page.data.find(
      (item) => item.provider === evidence.provider && item.model === evidence.model,
    );
    if (!observation) return unavailable(evidence, "no_matching_observation");
    const item: AvailableCaseEvidenceReviewItem = {
      ...base(evidence),
      type: "provider_observation",
      availability: "available",
      reference: {
        type: "provider_observation",
        provider: evidence.provider,
        model: evidence.model,
        range: structuredClone(evidence.range),
      },
      summary: {
        provider: evidence.provider,
        model: evidence.model,
        range: structuredClone(evidence.range),
        observation,
      },
    };
    return item;
  }
}

export function projectConclusionReadiness(
  investigationCase: InvestigationCase,
  evidence: CaseEvidenceReviewItem[],
): ConclusionReadiness {
  const scopePresent = Boolean(
    investigationCase.savedScope?.range?.from && investigationCase.savedScope.range.to,
  );
  const checks: ConclusionReadiness["checks"] = [
    {
      id: "exact_scope_present",
      satisfied: scopePresent,
      label: "Exact saved scope is present",
      explanation: scopePresent
        ? "The case has fixed from and to instants."
        : "A fixed from and to range is required.",
    },
    {
      id: "evidence_linked",
      satisfied: evidence.length > 0,
      label: "At least one evidence reference is linked",
      explanation:
        evidence.length > 0
          ? `${evidence.length} evidence reference${evidence.length === 1 ? " is" : "s are"} linked.`
          : "Link at least one authoritative evidence reference.",
    },
    {
      id: "evidence_reviewed",
      satisfied:
        evidence.length > 0 &&
        evidence.every(
          (item) => item.availability === "available" || item.availability === "unavailable",
        ),
      label: "Every evidence reference has a current review state",
      explanation:
        evidence.length > 0
          ? "Available and unavailable are both explicit review states; unavailable evidence remains visible."
          : "Link at least one evidence reference before review can be complete.",
    },
    {
      id: "finding_present",
      satisfied: hasText(investigationCase.finding),
      label: "Current finding is present",
      explanation: hasText(investigationCase.finding)
        ? "A current interpretation is recorded."
        : "Record a non-empty current finding.",
    },
    {
      id: "resolution_present",
      satisfied: hasText(investigationCase.resolution),
      label: "Current resolution is present",
      explanation: hasText(investigationCase.resolution)
        ? "A current decision or conclusion is recorded."
        : "Record a non-empty current resolution.",
    },
  ];
  return { ready: checks.every((check) => check.satisfied), checks };
}

function comparisonConditions(
  variation: CaseComparisonEvidenceSummary["requestedVariation"],
): ComparisonConditionReview[] {
  const conditions: Array<[string, string, boolean]> = [
    ["provider", "Provider", variation.provider !== undefined],
    ["model", "Model", variation.model !== undefined],
    ["policy.maxAttempts", "Maximum attempts", variation.policy?.maxAttempts !== undefined],
    [
      "policy.backoff",
      "Backoff policy",
      variation.policy?.baseBackoffMs !== undefined ||
        variation.policy?.maxBackoffMs !== undefined ||
        variation.policy?.jitterRatio !== undefined,
    ],
    [
      "policy.fallback",
      "Fallback route",
      variation.policy?.fallbackProvider !== undefined ||
        variation.policy?.fallbackModel !== undefined,
    ],
    ["budget.maxLatencyMs", "Latency budget", variation.budget?.maxLatencyMs !== undefined],
    ["budget.maxCostUsd", "Cost budget", variation.budget?.maxCostUsd !== undefined],
    ["structuredOutputRequired", "Structured output requirement", false],
    ["failureMode", "Deterministic failure mode", false],
  ];
  return conditions.map(([key, label, changed]) => ({
    key,
    label,
    state: changed ? "changed" : "inherited",
  }));
}

function base(evidence: InvestigationCaseEvidence) {
  return {
    evidenceId: evidence.evidenceId,
    caseId: evidence.caseId,
    addedAt: evidence.addedAt,
    sourceUrl: evidence.url,
  };
}

function reference(evidence: InvestigationCaseEvidence): InvestigationCaseEvidenceInput {
  if (evidence.type === "execution") {
    return { type: "execution", executionId: evidence.executionId };
  }
  if (evidence.type === "comparison") {
    return { type: "comparison", experimentId: evidence.experimentId };
  }
  return {
    type: "provider_observation",
    provider: evidence.provider,
    model: evidence.model,
    range: structuredClone(evidence.range),
  };
}

function unavailable(
  evidence: InvestigationCaseEvidence,
  reason:
    | "authoritative_evidence_not_found"
    | "current_read_unavailable"
    | "no_matching_observation"
    | "unsupported_historical_schema",
): CaseEvidenceReviewItem {
  const explanations = {
    authoritative_evidence_not_found:
      "The authoritative evidence is no longer available under this tenant.",
    current_read_unavailable: "The current authoritative read could not be completed.",
    no_matching_observation:
      "The exact saved provider, model, and range returned no matching observation.",
    unsupported_historical_schema:
      "The referenced evidence uses a historical schema this review does not support.",
  } as const;
  return {
    ...base(evidence),
    type: evidence.type,
    availability: "unavailable",
    reference: reference(evidence),
    reason,
    explanation: explanations[reason],
  };
}

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function constrainedErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonErrorThrown";
  const safe = error.name.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 80);
  return safe || "Error";
}
