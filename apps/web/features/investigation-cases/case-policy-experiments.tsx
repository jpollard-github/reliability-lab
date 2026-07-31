import Link from "next/link";
import type {
  AvailableCaseEvidenceReviewItem,
  CaseEvidenceReviewItem,
  InvestigationCaseReview,
} from "@reliability-lab/contracts";
import { CaseExperimentForm } from "./case-experiment-form";
import type { CaseExperimentCandidate } from "./case-experiment-model";
import { CaseComparisonLinkRecovery } from "./case-comparison-link-recovery";

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
      {review.comparisonLinkRecovery.totalPending ? (
        <section
          className="case-comparison-recovery"
          aria-labelledby="case-comparison-recovery-heading"
        >
          <div>
            <p className="eyebrow">Partial result</p>
            <h3 id="case-comparison-recovery-heading">Comparison link recovery required</h3>
          </div>
          <p>
            The comparison was created, but its evidence link did not complete. Open and link the
            existing comparison; starting another comparison would duplicate the experiment.
          </p>
          <ul>
            {review.comparisonLinkRecovery.items.map((recovery) => (
              <li key={recovery.experimentId}>
                <div>
                  <Link href={recovery.sourceUrl} className="mono">
                    {recovery.experimentId}
                  </Link>
                  <span>
                    Original {recovery.originalExecutionId} · failure recorded{" "}
                    <time dateTime={recovery.failureRecordedAt}>
                      {new Date(recovery.failureRecordedAt).toLocaleString("en-US", {
                        timeZone: "UTC",
                      })}{" "}
                      UTC
                    </time>
                  </span>
                </div>
                {recovery.availability === "available" ? (
                  <>
                    <span>Comparison {recovery.status}</span>
                    <CaseComparisonLinkRecovery
                      caseId={caseId}
                      experimentId={recovery.experimentId}
                    />
                  </>
                ) : (
                  <p>
                    {recovery.availability}: {recovery.explanation}
                  </p>
                )}
              </li>
            ))}
          </ul>
          {review.comparisonLinkRecovery.hasMore ? (
            <p className="form-warning">
              {review.comparisonLinkRecovery.totalPending -
                review.comparisonLinkRecovery.items.length}{" "}
              older pending recoveries remain outside this bounded view.
            </p>
          ) : null}
        </section>
      ) : null}
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
