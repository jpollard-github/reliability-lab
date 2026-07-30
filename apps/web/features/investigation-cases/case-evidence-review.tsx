import Link from "next/link";
import type { CaseEvidenceReviewItem, InvestigationCaseReview } from "@reliability-lab/contracts";

export function CaseEvidenceReview({ review }: { review: InvestigationCaseReview }) {
  return (
    <section
      aria-labelledby="evidence-review-heading"
      className="panel case-evidence-review"
      data-guide-anchor="case-review"
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Current authoritative reads</p>
          <h2 id="evidence-review-heading">Evidence review</h2>
          <p>
            Each linked reference remains in persisted order and resolves to a bounded current
            summary or an explicit unavailable state.
          </p>
        </div>
        <span className="mono">{review.evidence.length} references</span>
      </div>
      {review.evidence.length ? (
        <ol className="case-review-list">
          {review.evidence.map((evidence) => (
            <li key={evidence.evidenceId}>
              <ReviewItem evidence={evidence} />
            </li>
          ))}
        </ol>
      ) : (
        <div className="empty-state">
          <p>No evidence references are linked yet.</p>
        </div>
      )}
    </section>
  );
}

function ReviewItem({ evidence }: { evidence: CaseEvidenceReviewItem }) {
  return (
    <article>
      <div className="case-review-item-heading">
        <div>
          <span className="case-review-type">{evidence.type.replaceAll("_", " ")}</span>
          <strong>{identity(evidence)}</strong>
        </div>
        <span className={`case-review-availability availability-${evidence.availability}`}>
          {evidence.availability}
        </span>
      </div>
      {evidence.availability === "unavailable" ? (
        <div className="unavailable-evidence">
          <p>{evidence.explanation}</p>
          <p className="mono">{evidence.reason}</p>
        </div>
      ) : evidence.type === "execution" ? (
        <ExecutionFacts evidence={evidence} />
      ) : evidence.type === "comparison" ? (
        <ComparisonFacts evidence={evidence} />
      ) : (
        <ProviderFacts evidence={evidence} />
      )}
      <Link href={evidence.sourceUrl}>Open authoritative source</Link>
    </article>
  );
}

function ExecutionFacts({
  evidence,
}: {
  evidence: Extract<CaseEvidenceReviewItem, { type: "execution"; availability: "available" }>;
}) {
  const summary = evidence.summary;
  return (
    <dl className="case-review-facts">
      <dt>Status</dt>
      <dd>{summary.status}</dd>
      <dt>Initial route</dt>
      <dd>
        {summary.initialProvider} / {summary.initialModel}
      </dd>
      <dt>Final route</dt>
      <dd>
        {summary.finalProvider ?? "Unavailable"} / {summary.finalModel ?? "Unavailable"}
      </dd>
      <dt>Attempts / retries</dt>
      <dd>
        {summary.attemptCount} / {summary.retryCount}
      </dd>
      <dt>Duration</dt>
      <dd>{summary.durationMs === undefined ? "Unavailable" : `${summary.durationMs} ms`}</dd>
      <dt>Signals</dt>
      <dd>{summary.signals.length ? summary.signals.join(", ") : "None recorded"}</dd>
      <dt>Terminal error</dt>
      <dd>
        {summary.errorCategory && summary.errorCode
          ? `${summary.errorCategory} / ${summary.errorCode}`
          : "None recorded"}
      </dd>
      <dt>Replay capability</dt>
      <dd>
        {summary.replayCapability.state}: {summary.replayCapability.reason}
      </dd>
    </dl>
  );
}

function ComparisonFacts({
  evidence,
}: {
  evidence: Extract<CaseEvidenceReviewItem, { type: "comparison"; availability: "available" }>;
}) {
  const summary = evidence.summary;
  return (
    <>
      <dl className="case-review-facts">
        <dt>Status</dt>
        <dd>{summary.status}</dd>
        <dt>Original</dt>
        <dd>
          {summary.originalExecutionId} ({summary.originalStatus})
        </dd>
        <dt>Variant</dt>
        <dd>
          {summary.variantExecutionId
            ? `${summary.variantExecutionId} (${summary.variantStatus ?? "unavailable"})`
            : "Unavailable"}
        </dd>
        <dt>Conditions</dt>
        <dd>
          {summary.conditions
            .filter((item) => item.state === "changed")
            .map((item) => item.label)
            .join(", ") || "Same-condition reproducibility check"}
        </dd>
      </dl>
      <p>{summary.summary}</p>
      <details>
        <summary>Review {summary.dimensions.length} comparison dimensions</summary>
        <ul className="comparison-dimension-review">
          {summary.dimensions.map((dimension) => (
            <li key={dimension.key}>
              <strong>
                {dimension.label}: {dimension.change}
              </strong>
              <span>{dimension.explanation}</span>
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

function ProviderFacts({
  evidence,
}: {
  evidence: Extract<
    CaseEvidenceReviewItem,
    { type: "provider_observation"; availability: "available" }
  >;
}) {
  const observation = evidence.summary.observation;
  return (
    <dl className="case-review-facts">
      <dt>Exact range</dt>
      <dd>
        {formatDate(evidence.summary.range.from)} through {formatDate(evidence.summary.range.to)}
      </dd>
      <dt>Attempts / executions</dt>
      <dd>
        {observation.attemptCount} / {observation.executionCount}
      </dd>
      <dt>Terminal sample</dt>
      <dd>{observation.terminalAttemptCount}</dd>
      <dt>Succeeded / failed / timed out / rejected / running</dt>
      <dd>
        {observation.succeededAttempts} / {observation.failedAttempts} /{" "}
        {observation.timedOutAttempts} / {observation.rejectedAttempts} /{" "}
        {observation.runningAttempts}
      </dd>
      <dt>Observed success rate</dt>
      <dd>
        {observation.observedSuccessRate === null
          ? "Unavailable"
          : `${(observation.observedSuccessRate * 100).toFixed(1)}%`}{" "}
        ({observation.terminalAttemptCount} terminal attempts)
      </dd>
      <dt>Latency sample / p50 / p95</dt>
      <dd>
        {observation.latencySampleSize} / {observation.p50LatencyMs ?? "Unavailable"} /{" "}
        {observation.p95LatencyMs ?? "Unavailable"} ms
      </dd>
      <dt>Rate limited / unavailable / provider errors</dt>
      <dd>
        {observation.rateLimitedAttempts} / {observation.providerUnavailableAttempts} /{" "}
        {observation.providerErrors}
      </dd>
      <dt>Structured rejections / fallback selections</dt>
      <dd>
        {observation.structuredOutputRejections} / {observation.fallbackSelectedToRoute}
      </dd>
      <dt>Sample assessment</dt>
      <dd>{observation.sampleAssessment.replaceAll("_", " ")}</dd>
    </dl>
  );
}

function identity(evidence: CaseEvidenceReviewItem): string {
  if (evidence.reference.type === "execution") return evidence.reference.executionId;
  if (evidence.reference.type === "comparison") return evidence.reference.experimentId;
  return `${evidence.reference.provider} / ${evidence.reference.model}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}
