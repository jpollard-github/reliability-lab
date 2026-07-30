import type {
  CreateInvestigationCaseComparisonBody,
  ExecutionEnvelope,
  InvestigationCaseComparisonResult,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionService } from "../execution/execution-service.js";
import type { InvestigationCaseService } from "./investigation-case-service.js";
import { InvestigationCaseInputError } from "./errors.js";

export interface InvestigationCaseExperimentDiagnostic {
  caseId: string;
  experimentId: string;
  operation: "link_comparison_evidence" | "record_comparison_link_failure";
  errorName: string;
}

export interface InvestigationCaseExperimentSubmission {
  result: InvestigationCaseComparisonResult;
  completion?: Promise<ExecutionEnvelope>;
}

/**
 * Coordinates one ordinary comparison from evidence already linked to a saved case.
 * Comparison creation and case linking are deliberately separate, explicit commit boundaries.
 */
export class InvestigationCaseExperimentService {
  readonly #cases: InvestigationCaseService;
  readonly #executions: ExecutionService;
  readonly #onDiagnostic: ((diagnostic: InvestigationCaseExperimentDiagnostic) => void) | undefined;

  constructor(options: {
    cases: InvestigationCaseService;
    executions: ExecutionService;
    onDiagnostic?: (diagnostic: InvestigationCaseExperimentDiagnostic) => void;
  }) {
    this.#cases = options.cases;
    this.#executions = options.executions;
    this.#onDiagnostic = options.onDiagnostic;
  }

  async create(
    tenantId: TenantId,
    caseId: string,
    input: CreateInvestigationCaseComparisonBody,
  ): Promise<InvestigationCaseExperimentSubmission> {
    const detail = await this.#cases.get(tenantId, caseId);
    const selected = detail.evidence.find(
      (evidence) => evidence.evidenceId === input.executionEvidenceId,
    );
    if (!selected || selected.type !== "execution") {
      throw new InvestigationCaseInputError(
        "Selected evidence must be an execution already linked to this case",
      );
    }

    // This current tenant-scoped read rejects stale or cross-tenant source evidence before creation.
    await this.#executions.get(tenantId, selected.executionId);
    const comparison = await this.#executions.createComparison(
      tenantId,
      selected.executionId,
      input.variation,
    );
    const experimentId = comparison.experiment.experimentId;

    try {
      const linked = await this.#cases.addEvidence(
        tenantId,
        caseId,
        { type: "comparison", experimentId },
        {
          comparisonStarted: {
            experimentId,
            originalExecutionId: selected.executionId,
          },
        },
      );
      return {
        result: {
          kind: "comparison_linked",
          experiment: structuredClone(comparison.experiment),
          evidenceId: linked.evidence.evidenceId,
        },
        ...(comparison.completion ? { completion: comparison.completion } : {}),
      };
    } catch (error) {
      this.#diagnose(caseId, experimentId, "link_comparison_evidence", error);
      try {
        await this.#cases.recordComparisonLinkFailure(tenantId, caseId, {
          experimentId,
          originalExecutionId: selected.executionId,
        });
      } catch (timelineError) {
        this.#diagnose(caseId, experimentId, "record_comparison_link_failure", timelineError);
      }
      return {
        result: {
          kind: "comparison_created_link_failed",
          experiment: structuredClone(comparison.experiment),
          recovery: {
            kind: "link_existing_comparison",
            experimentId,
          },
        },
        ...(comparison.completion ? { completion: comparison.completion } : {}),
      };
    }
  }

  #diagnose(
    caseId: string,
    experimentId: string,
    operation: InvestigationCaseExperimentDiagnostic["operation"],
    error: unknown,
  ): void {
    if (!this.#onDiagnostic) return;
    try {
      this.#onDiagnostic({
        caseId,
        experimentId,
        operation,
        errorName: constrainedErrorName(error),
      });
    } catch {
      // Diagnostics cannot erase the explicit partial-link result.
    }
  }
}

function constrainedErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonErrorThrown";
  const safe = error.name.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 80);
  return safe || "Error";
}
