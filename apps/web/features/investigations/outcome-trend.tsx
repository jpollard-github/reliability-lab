import type { ReliabilitySummary } from "@reliability-lab/contracts";
import { formatDate } from "./time-window-toolbar";

export function OutcomeTrend({ summary }: { summary: ReliabilitySummary }) {
  const max = Math.max(1, ...summary.trend.map((bucket) => bucket.total));
  return (
    <section className="panel" id="provider-observations">
      <div className="panel-heading">
        <div>
          <h2>Outcome trend</h2>
          <p>Success, degraded, and failed terminal executions by bounded time bucket.</p>
        </div>
        <span className="muted">
          Usage evidence {summary.usage.executionCoverage}/{summary.population.total} · cost{" "}
          {summary.usage.costCoverage}/{summary.population.total}
        </span>
      </div>
      {!summary.trend.some((bucket) => bucket.total) ? (
        <div className="empty-state">
          <p>No executions were recorded in this time window.</p>
          <p>Choose a wider preset or create a deterministic run from the executions page.</p>
        </div>
      ) : (
        <ol className="outcome-trend" aria-label="Execution outcomes over time">
          {summary.trend.map((bucket) => (
            <li
              aria-label={`${formatDate(bucket.from)}: ${bucket.succeeded} succeeded, ${bucket.degraded} degraded, ${bucket.failed} failed, ${bucket.total} total`}
              key={bucket.from}
            >
              <time dateTime={bucket.from}>{shortDate(bucket.from)}</time>
              <div className="trend-track">
                <span
                  className="trend-success"
                  style={{ width: `${(bucket.succeeded / max) * 100}%` }}
                />
                <span
                  className="trend-warning"
                  style={{ width: `${(bucket.degraded / max) * 100}%` }}
                />
                <span
                  className="trend-danger"
                  style={{ width: `${(bucket.failed / max) * 100}%` }}
                />
              </div>
              <span className="mono">{bucket.total}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function shortDate(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}
