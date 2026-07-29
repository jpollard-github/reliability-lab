import type { InvestigationCaseDetail } from "@reliability-lab/contracts";

export function CaseOverview({ detail }: { detail: InvestigationCaseDetail }) {
  const item = detail.case;
  return (
    <>
      <section className="case-overview">
        <article className="panel">
          <h2>Reliability question</h2>
          <p className="case-prose">{item.question}</p>
          <dl className="case-facts">
            <dt>Created</dt>
            <dd>{new Date(item.createdAt).toLocaleString()}</dd>
            <dt>Updated</dt>
            <dd>{new Date(item.updatedAt).toLocaleString()}</dd>
            <dt>Resolved</dt>
            <dd>{item.resolvedAt ? new Date(item.resolvedAt).toLocaleString() : "—"}</dd>
          </dl>
        </article>
        <article className="panel">
          <h2>Exact saved scope</h2>
          <p>
            {new Date(item.savedScope.range.from).toLocaleString()} through{" "}
            {new Date(item.savedScope.range.to).toLocaleString()}
          </p>
          <div className="active-filters">
            {scopeChips(item.savedScope).map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
          <p className="muted">This range is fixed and does not slide forward.</p>
        </article>
      </section>
      <section className="case-overview">
        <article className="panel">
          <h2>Current finding</h2>
          <p className="case-prose">{item.finding || "No finding recorded yet."}</p>
        </article>
        <article className="panel">
          <h2>Resolution</h2>
          <p className="case-prose">{item.resolution || "No resolution recorded yet."}</p>
        </article>
      </section>
    </>
  );
}

function scopeChips(scope: InvestigationCaseDetail["case"]["savedScope"]): string[] {
  return [
    ...(scope.query ? [`query: ${scope.query}`] : []),
    ...(scope.statuses ?? []).map((value) => `status: ${value}`),
    ...(scope.providers ?? []).map((value) => `provider: ${value}`),
    ...(scope.models ?? []).map((value) => `model: ${value}`),
    ...(scope.errorCategory ? [`error category: ${scope.errorCategory}`] : []),
    ...(scope.errorCode ? [`error code: ${scope.errorCode}`] : []),
    ...(scope.signal ? [`signal: ${scope.signal}`] : []),
  ];
}
