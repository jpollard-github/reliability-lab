import Link from "next/link";
import type {
  AvailableCaseEvidenceReviewItem,
  CaseEvidenceReviewItem,
  InvestigationCaseReview,
} from "@reliability-lab/contracts";
import { CaseExperimentForm } from "./case-experiment-form";
import type { CaseExperimentCandidate } from "./case-experiment-model";

/**
 * Server-rendered case experiment eligibility; the focused form is the only client island.
 */
export function CasePolicyExperiments({
  caseId,
  review,
}: {
  caseId: string;
  review: InvestigationCaseReview;
}) {
  const linkedExecutions = review.evidence.filter((item) => item.type === "execution");
  const candidates: CaseExperimentCandidate[] = review.evidence.flatMap((item) => {
    if (!isAvailableExecution(item) || !item.summary.replayCapability.available) return [];
    return [
      {
        evidenceId: item.evidenceId,
        executionId: item.summary.executionId,
        status: item.summary.status,
        provider: item.summary.initialProvider,
        model: item.summary.initialModel,
        policy: item.summary.policy,
        budget: item.summary.budget,
        replayState: item.summary.replayCapability.state,
        replayReason: item.summary.replayCapability.reason,
      },
    ];
  });

  return (
    <section
      className="panel case-experiment-panel"
      aria-labelledby="case-experiment-heading"
      data-guide-anchor="case-experiment"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Case policy experiment</p>
          <h2 id="case-experiment-heading">Run controlled experiment</h2>
        </div>
        <span className="subtle-count">
          {candidates.length} eligible / {linkedExecutions.length} linked
        </span>
      </div>
      <p>
        Choose execution evidence already linked to this case. Retained input stays fixed; only the
        bounded provider, model, retry, fallback, and budget conditions below may change. One
        submission creates one ordinary comparison and attempts to link it back to this case.
      </p>
      {linkedExecutions.length ? (
        <ul className="case-experiment-eligibility">
          {linkedExecutions.map((item) => (
            <li key={item.evidenceId}>
              <div>
                <Link href={item.sourceUrl} className="mono">
                  {executionId(item)}
                </Link>
                <span>{executionStatus(item)}</span>
              </div>
              <strong>{eligibilityLabel(item)}</strong>
              <span>{eligibilityExplanation(item)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-state">
          Link execution evidence to this case before starting a controlled comparison.
        </p>
      )}
      {candidates.length ? (
        <CaseExperimentForm caseId={caseId} candidates={candidates} />
      ) : (
        <p className="empty-state">
          No linked execution currently has replay capability. Expired, deleted, missing, or
          policy-disabled retained input cannot start an experiment.
        </p>
      )}
    </section>
  );
}

function executionId(item: InvestigationCaseReview["evidence"][number]): string {
  return item.type === "execution" && item.reference.type === "execution"
    ? item.reference.executionId
    : item.evidenceId;
}

function executionStatus(item: InvestigationCaseReview["evidence"][number]): string {
  return item.type === "execution" && item.availability === "available"
    ? item.summary.status
    : "unavailable";
}

function eligibilityLabel(item: InvestigationCaseReview["evidence"][number]): string {
  return item.type === "execution" &&
    item.availability === "available" &&
    item.summary.replayCapability.available
    ? "Eligible"
    : "Not eligible";
}

function eligibilityExplanation(item: InvestigationCaseReview["evidence"][number]): string {
  if (item.type !== "execution") return "Not execution evidence.";
  if (item.availability === "unavailable") return item.explanation;
  return `Replay ${item.summary.replayCapability.state}: ${item.summary.replayCapability.reason}`;
}

function isAvailableExecution(
  item: CaseEvidenceReviewItem,
): item is Extract<AvailableCaseEvidenceReviewItem, { type: "execution" }> {
  return item.type === "execution" && item.availability === "available";
}
