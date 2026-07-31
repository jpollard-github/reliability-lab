import type {
  CaseComparisonLinkRecovery,
  CaseComparisonLinkRecoveryProjection,
  InvestigationCaseEvidence,
  InvestigationCaseTimelineEvent,
  TenantId,
} from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository } from "../comparison/repository.js";

export const CASE_COMPARISON_RECOVERY_LIMIT = 50;
const RECOVERY_READ_CONCURRENCY = 5;

export interface PendingComparisonLinkRecovery {
  experimentId: string;
  originalExecutionId: string;
  failureRecordedAt: string;
}

export interface ComparisonLinkRecoveryDiagnostic {
  caseId: string;
  evidenceId: string;
  evidenceType: "comparison";
  operation: "read_comparison_link_recovery";
  errorName: string;
}

/**
 * Reconstructs unresolved case-comparison link failures from append-only lifecycle evidence.
 * Timeline order is authoritative; a completion closes earlier failures even after evidence removal.
 */
export function pendingComparisonLinkRecoveries(
  timeline: InvestigationCaseTimelineEvent[],
  evidence: InvestigationCaseEvidence[],
): PendingComparisonLinkRecovery[] {
  const pending = new Map<string, PendingComparisonLinkRecovery>();
  for (const event of timeline) {
    if (
      event.type !== "case.comparison_link_failed" &&
      event.type !== "case.comparison_link_recovered"
    ) {
      continue;
    }
    const experimentId = metadataString(event, "experimentId");
    if (!experimentId) continue;
    if (event.type === "case.comparison_link_recovered") {
      pending.delete(experimentId);
      continue;
    }
    const originalExecutionId = metadataString(event, "originalExecutionId");
    if (!originalExecutionId) continue;
    pending.set(experimentId, {
      experimentId,
      originalExecutionId,
      failureRecordedAt: event.occurredAt,
    });
  }
  for (const item of evidence) {
    if (item.type === "comparison") pending.delete(item.experimentId);
  }
  return [...pending.values()];
}

export function isPendingComparisonLinkRecovery(
  timeline: InvestigationCaseTimelineEvent[],
  evidence: InvestigationCaseEvidence[],
  experimentId: string,
): boolean {
  return pendingComparisonLinkRecoveries(timeline, evidence).some(
    (item) => item.experimentId === experimentId,
  );
}

export async function projectComparisonLinkRecovery(options: {
  tenantId: TenantId;
  caseId: string;
  timeline: InvestigationCaseTimelineEvent[];
  evidence: InvestigationCaseEvidence[];
  comparisons: ComparisonExperimentRepository;
  onDiagnostic?: (diagnostic: ComparisonLinkRecoveryDiagnostic) => void;
}): Promise<CaseComparisonLinkRecoveryProjection> {
  const allPending = pendingComparisonLinkRecoveries(options.timeline, options.evidence);
  const visible = allPending.slice(0, CASE_COMPARISON_RECOVERY_LIMIT);
  const items: CaseComparisonLinkRecovery[] = [];
  for (let index = 0; index < visible.length; index += RECOVERY_READ_CONCURRENCY) {
    const batch = visible.slice(index, index + RECOVERY_READ_CONCURRENCY);
    items.push(...(await Promise.all(batch.map((item) => resolveRecovery(options, item)))));
  }
  return {
    items,
    totalPending: allPending.length,
    hasMore: allPending.length > visible.length,
  };
}

async function resolveRecovery(
  options: Parameters<typeof projectComparisonLinkRecovery>[0],
  pending: PendingComparisonLinkRecovery,
): Promise<CaseComparisonLinkRecovery> {
  const base = {
    ...pending,
    sourceUrl: `/comparisons/${encodeURIComponent(pending.experimentId)}`,
  };
  try {
    const experiment = await options.comparisons.findById(options.tenantId, pending.experimentId);
    if (!experiment) {
      return {
        ...base,
        availability: "missing",
        reason: "authoritative_comparison_not_found",
        explanation: "The comparison is not available under this tenant.",
      };
    }
    return {
      ...base,
      availability: "available",
      status: experiment.status,
      action: "link_existing_comparison",
    };
  } catch (error) {
    diagnose(options, pending, error);
    return {
      ...base,
      availability: "unavailable",
      reason: "current_read_unavailable",
      explanation: "The current comparison read could not be completed.",
    };
  }
}

function diagnose(
  options: Parameters<typeof projectComparisonLinkRecovery>[0],
  pending: PendingComparisonLinkRecovery,
  error: unknown,
): void {
  if (!options.onDiagnostic) return;
  try {
    options.onDiagnostic({
      caseId: options.caseId,
      evidenceId: `comparison-recovery:${pending.experimentId}`,
      evidenceType: "comparison",
      operation: "read_comparison_link_recovery",
      errorName: constrainedErrorName(error),
    });
  } catch {
    // Diagnostics must never replace the explicit user-facing unavailable state.
  }
}

function metadataString(event: InvestigationCaseTimelineEvent, key: string): string | undefined {
  const value = event.metadata[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function constrainedErrorName(error: unknown): string {
  if (!(error instanceof Error)) return "NonErrorThrown";
  const safe = error.name.replace(/[^A-Za-z0-9_.-]/gu, "").slice(0, 80);
  return safe || "Error";
}
