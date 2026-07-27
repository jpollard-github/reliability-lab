import type { ExecutionEvent } from "@reliability-lab/contracts";

export function EventTimeline({ events }: { events: ExecutionEvent[] }) {
  return (
    <ol className="timeline">
      {events.map((event) => (
        <li key={event.eventId}>
          <div className="timeline-marker" aria-hidden="true" />
          <div className="timeline-content">
            <div>
              <strong>{event.type.replaceAll(".", " · ").replaceAll("_", " ")}</strong>
              <span className="sequence">#{event.sequence}</span>
            </div>
            <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
            <EventDetails event={event} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function EventDetails({ event }: { event: ExecutionEvent }) {
  switch (event.type) {
    case "attempt.started":
      return (
        <p>
          {event.provider} / {event.model}, attempt {event.attemptNumber}
        </p>
      );
    case "retry.scheduled":
      return (
        <p>
          Retry in {event.delayMs} ms after {event.reason}
        </p>
      );
    case "fallback.selected":
      return (
        <p>
          Selected {event.provider} / {event.model}: {event.reason}
        </p>
      );
    case "structured_output.rejected":
      return <p>{event.errors.join("; ")}</p>;
    case "execution.failed":
      return (
        <p>
          {event.error.category}: {event.error.message}
        </p>
      );
    case "replay.completed":
      return <p>Outcome {event.outcomeMatches ? "matched" : "differed"} from original.</p>;
    default:
      return null;
  }
}
