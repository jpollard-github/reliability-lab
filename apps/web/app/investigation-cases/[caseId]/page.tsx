import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseControls } from "@/components/case-controls";
import { getInvestigationCase } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function InvestigationCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const detail = await getInvestigationCase(caseId);
  if (!detail) notFound();
  const item = detail.case;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/investigation-cases">Cases</Link>
        <span>/</span>
        <span className="mono">{item.caseId}</span>
      </div>
      <section className="detail-heading">
        <div>
          <p className="eyebrow">Investigation case v{item.schemaVersion}</p>
          <h1>{item.title}</h1>
          <div className="detail-subtitle">
            <span className={`case-status case-${item.status}`}>{item.status}</span>
            {item.importance ? (
              <span className={`case-importance importance-${item.importance}`}>
                {item.importance}
              </span>
            ) : null}
            <span className="mono">{item.caseId}</span>
          </div>
        </div>
        <Link className="workbench-link" href={detail.links.savedWorkbench}>
          Open saved workbench scope
        </Link>
      </section>

      <section className="panel actor-limitation" aria-labelledby="actor-limitation-heading">
        <h2 id="actor-limitation-heading">Actor identity is unavailable</h2>
        <p>
          This prototype has tenant routing but no authenticated users. Notes and lifecycle events
          intentionally record timestamps without claiming who made a change.
        </p>
      </section>

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

      <CaseControls detail={detail} />

      <section className="case-two-column">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Append-only notes</h2>
              <p>Corrections appear as later notes.</p>
            </div>
          </div>
          {detail.notes.length ? (
            <ol className="case-notes">
              {detail.notes.map((note) => (
                <li key={note.noteId}>
                  <time dateTime={note.createdAt}>{new Date(note.createdAt).toLocaleString()}</time>
                  <p>{note.body}</p>
                </li>
              ))}
            </ol>
          ) : (
            <div className="empty-state">
              <p>No notes recorded yet.</p>
            </div>
          )}
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Metadata timeline</h2>
              <p>Safe lifecycle metadata; operational prose is not duplicated here.</p>
            </div>
          </div>
          <ol className="case-timeline">
            {detail.timeline.map((event) => (
              <li key={event.eventId}>
                <span className="timeline-marker" />
                <div>
                  <strong>{event.type.replaceAll(".", " ")}</strong>
                  <time dateTime={event.occurredAt}>
                    {new Date(event.occurredAt).toLocaleString()}
                  </time>
                  {Object.keys(event.metadata).length ? (
                    <small>{formatMetadata(event.metadata)}</small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>
    </>
  );
}

function scopeChips(
  scope: NonNullable<Awaited<ReturnType<typeof getInvestigationCase>>>["case"]["savedScope"],
) {
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

function formatMetadata(metadata: Record<string, string | number | boolean | null>) {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}
