import type { InvestigationCaseDetail } from "@reliability-lab/contracts";

export function CaseTimeline({ timeline }: { timeline: InvestigationCaseDetail["timeline"] }) {
  return (
    <article className="panel" data-guide-anchor="case-timeline">
      <div className="panel-heading">
        <div>
          <h2>Metadata timeline</h2>
          <p>Safe lifecycle metadata; operational prose is not duplicated here.</p>
        </div>
      </div>
      <ol className="case-timeline">
        {timeline.map((event) => (
          <li key={event.eventId}>
            <span className="timeline-marker" />
            <div>
              <strong>{event.type.replaceAll(".", " ")}</strong>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
              {Object.keys(event.metadata).length ? (
                <small>{formatMetadata(event.metadata)}</small>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}

function formatMetadata(metadata: Record<string, string | number | boolean | null>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}
