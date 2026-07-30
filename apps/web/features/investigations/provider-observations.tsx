import Link from "next/link";
import type { ProviderObservationPage } from "@reliability-lab/contracts";
import { formatLatency, formatRate } from "./reliability-summary-cards";
import { routeHref } from "./search-state";

export function ProviderObservations({
  providers,
  current,
}: {
  providers: ProviderObservationPage;
  current: URLSearchParams;
}) {
  return (
    <section
      className="panel"
      data-guide-anchor="workbench-provider-observations"
      id="provider-observations"
    >
      <div className="panel-heading">
        <div>
          <h2>Provider/model observations</h2>
          <p>Attempt-level evidence with explicit sample sizes; no universal score.</p>
        </div>
      </div>
      {providers.data.length ? (
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Attempts</th>
                <th>Outcomes</th>
                <th>Success rate</th>
                <th>p50 / p95</th>
                <th>Rate limit</th>
                <th>Unavailable</th>
                <th>Schema reject</th>
                <th>Fallback selected</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {providers.data.map((provider) => (
                <tr key={`${provider.provider}/${provider.model}`}>
                  <td>
                    <Link
                      className="execution-link"
                      href={routeHref(current, provider.provider, provider.model)}
                    >
                      {provider.provider} / {provider.model}
                    </Link>
                  </td>
                  <td>
                    {provider.attemptCount} across {provider.executionCount} executions
                  </td>
                  <td>
                    {provider.succeededAttempts} ok · {provider.failedAttempts} failed ·{" "}
                    {provider.timedOutAttempts} timed out · {provider.runningAttempts} running
                  </td>
                  <td>{formatRate(provider.observedSuccessRate)}</td>
                  <td>
                    {formatLatency(provider.p50LatencyMs)} / {formatLatency(provider.p95LatencyMs)}
                  </td>
                  <td>{provider.rateLimitedAttempts}</td>
                  <td>{provider.providerUnavailableAttempts}</td>
                  <td>{provider.structuredOutputRejections}</td>
                  <td>{provider.fallbackSelectedToRoute}</td>
                  <td>
                    <span className={`sample-label sample-${provider.sampleAssessment}`}>
                      {provider.sampleAssessment.replaceAll("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <p>No attempt-level provider evidence exists in this window.</p>
          <p>Queued executions without attempts do not create provider observations.</p>
        </div>
      )}
    </section>
  );
}
