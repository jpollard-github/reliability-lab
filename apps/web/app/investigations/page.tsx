import Link from "next/link";
import type { ReliabilitySummary } from "@reliability-lab/contracts";
import { ExecutionTable } from "@/components/execution-table";
import {
  getInvestigationSummary,
  getProviderObservations,
  searchInvestigationExecutions,
} from "@/lib/api";

export const dynamic = "force-dynamic";

type SearchValue = string | string[] | undefined;
type WorkbenchSearchParams = Record<string, SearchValue>;
type WindowPreset = "1h" | "24h" | "7d" | "30d";

const PRESET_MS: Record<WindowPreset, number> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export default async function InvestigationsPage({
  searchParams,
}: {
  searchParams: Promise<WorkbenchSearchParams>;
}) {
  const raw = await searchParams;
  const current = toUrlSearchParams(raw);
  const range = resolveRange(raw);
  const rangeParams = new URLSearchParams({ from: range.from, to: range.to });
  const executionParams = new URLSearchParams(rangeParams);
  copyFilters(current, executionParams, [
    "cursor",
    "q",
    "status",
    "provider",
    "model",
    "errorCategory",
    "errorCode",
    "signal",
  ]);
  executionParams.set("limit", "25");
  const providerParams = new URLSearchParams(rangeParams);
  copyFilters(current, providerParams, ["provider", "model"]);

  const [summary, providers, executions] = await Promise.all([
    getInvestigationSummary(rangeParams),
    getProviderObservations(providerParams),
    searchInvestigationExecutions(executionParams),
  ]);
  const returnTo = `/investigations${current.size ? `?${current.toString()}` : ""}`;
  const selectedWindow = isWindowPreset(first(raw.window)) ? first(raw.window) : "24h";

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Operator evidence</p>
          <h1>Investigation workbench</h1>
          <p>
            Bounded, tenant-scoped reliability evidence. Counts are observations, not provider
            rankings.
          </p>
        </div>
        <div className="workbench-context">
          <Link className="workbench-link" href={`/investigations?${current.toString()}`}>
            Refresh evidence
          </Link>
          <div className="environment-pill">
            <span />
            local · demo-tenant
          </div>
        </div>
      </section>

      <section className="workbench-toolbar panel" aria-labelledby="time-window-heading">
        <div className="panel-heading">
          <div>
            <h2 id="time-window-heading">Time window</h2>
            <p>
              {formatDate(range.from)} through {formatDate(range.to)}
            </p>
          </div>
          <div className="preset-links" aria-label="Time window presets">
            {(["1h", "24h", "7d", "30d"] as const).map((preset) => (
              <Link
                aria-current={selectedWindow === preset ? "page" : undefined}
                className={selectedWindow === preset ? "active" : undefined}
                href={`/investigations?window=${preset}`}
                key={preset}
              >
                {preset}
              </Link>
            ))}
          </div>
        </div>
        <form className="custom-range-form" method="get">
          <label>
            From
            <input
              defaultValue={range.from.slice(0, 16)}
              max={range.to.slice(0, 16)}
              name="from"
              type="datetime-local"
            />
          </label>
          <label>
            To
            <input
              defaultValue={range.to.slice(0, 16)}
              min={range.from.slice(0, 16)}
              name="to"
              type="datetime-local"
            />
          </label>
          <button type="submit">Apply custom range</button>
        </form>
      </section>

      <section className="investigation-cards" aria-label="Reliability summary">
        <DrillCard
          href={filterHref(current, "status", "succeeded")}
          label="Success rate"
          note={`${summary.outcomes.succeeded} of ${summary.population.terminal} terminal`}
          tone="success"
          value={formatRate(summary.outcomes.successRate)}
        />
        <DrillCard
          href={filterHref(current, "status", "degraded")}
          label="Degraded"
          note="terminal executions"
          tone="warning"
          value={String(summary.outcomes.degraded)}
        />
        <DrillCard
          href={filterHref(current, "status", "failed")}
          label="Failed"
          note="terminal executions"
          tone="danger"
          value={String(summary.outcomes.failed)}
        />
        <DrillCard
          href={filterHref(current, "signal", "retry_recovered")}
          label="Retry recovered"
          note="event-derived"
          value={String(summary.signals.retryRecovered)}
        />
        <DrillCard
          href={filterHref(current, "signal", "fallback_used")}
          label="Fallback dependent"
          note="event-derived"
          value={String(summary.signals.fallbackUsed)}
        />
        <DrillCard
          href={filterHref(current, "signal", "latency_budget_exceeded")}
          label="Latency budget"
          note="exceeded"
          value={String(summary.signals.latencyBudgetExceeded)}
        />
        <DrillCard
          href={filterHref(current, "signal", "structured_output_rejected")}
          label="Schema rejected"
          note="structured output"
          value={String(summary.signals.structuredOutputRejected)}
        />
        <DrillCard
          href={filterHref(current, "signal", "provider_outcome_ambiguous")}
          label="Ambiguous outcome"
          note="provider-call evidence"
          tone="danger"
          value={String(summary.signals.providerOutcomeAmbiguous)}
        />
        <DrillCard
          href="#execution-explorer"
          label="p95 latency"
          note={`${summary.latency.sampleSize} terminal samples`}
          value={formatLatency(summary.latency.p95Ms)}
        />
      </section>

      <section className="panel">
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
        <OutcomeTrend summary={summary} />
      </section>

      <section className="panel">
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
                      {formatLatency(provider.p50LatencyMs)} /{" "}
                      {formatLatency(provider.p95LatencyMs)}
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

      <section className="panel" id="execution-explorer">
        <div className="panel-heading">
          <div>
            <h2>Execution explorer</h2>
            <p>Exact-prefix identity search and evidence-backed filters.</p>
          </div>
          <span className="muted">{executions.total} matching records</span>
        </div>
        <form className="investigation-filter-form" method="get">
          {first(raw.from) && first(raw.to) ? (
            <>
              <input name="from" type="hidden" value={first(raw.from)} />
              <input name="to" type="hidden" value={first(raw.to)} />
            </>
          ) : (
            <input name="window" type="hidden" value={selectedWindow} />
          )}
          <label>
            Execution or trace prefix
            <input defaultValue={first(raw.q)} name="q" placeholder="UUID or trace ID" />
          </label>
          <label>
            Status
            <select defaultValue={all(raw.status)} multiple name="status" size={3}>
              <option value="">Any status</option>
              {["queued", "running", "succeeded", "degraded", "failed", "cancelled"].map(
                (status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Signal
            <select defaultValue={first(raw.signal) ?? ""} name="signal">
              <option value="">Any signal</option>
              {[
                "retry_recovered",
                "fallback_used",
                "latency_budget_exceeded",
                "structured_output_rejected",
                "provider_outcome_ambiguous",
                "replay_derived",
              ].map((signal) => (
                <option key={signal} value={signal}>
                  {signal.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Provider
            <input defaultValue={first(raw.provider)} name="provider" placeholder="fake-primary" />
          </label>
          <label>
            Model
            <input defaultValue={first(raw.model)} name="model" placeholder="deterministic-v1" />
          </label>
          <label>
            Error category
            <select defaultValue={first(raw.errorCategory) ?? ""} name="errorCategory">
              <option value="">Any category</option>
              {[
                "timeout",
                "rate_limit",
                "authentication",
                "invalid_request",
                "provider_unavailable",
                "malformed_response",
                "budget_exceeded",
                "unknown",
              ].map((category) => (
                <option key={category} value={category}>
                  {category.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Error code
            <input defaultValue={first(raw.errorCode)} name="errorCode" placeholder="exact code" />
          </label>
          <button type="submit">Apply filters</button>
        </form>
        <ActiveFilters params={current} />
        <ExecutionTable executions={executions.data} returnTo={returnTo} />
        <div className="pagination">
          {current.has("cursor") ? (
            <Link href={withoutParam(current, "cursor")}>First page</Link>
          ) : (
            <span />
          )}
          <span className="muted">Use browser back for the previous cursor page.</span>
          {executions.nextCursor ? (
            <Link href={filterHref(current, "cursor", executions.nextCursor)}>Next page</Link>
          ) : (
            <span className="muted">End of results</span>
          )}
        </div>
      </section>
    </>
  );
}

function DrillCard({
  href,
  label,
  value,
  note,
  tone = "neutral",
}: {
  href: string;
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <Link className={`investigation-card metric-${tone}`} href={href}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </Link>
  );
}

function OutcomeTrend({ summary }: { summary: ReliabilitySummary }) {
  const max = Math.max(1, ...summary.trend.map((bucket) => bucket.total));
  if (!summary.trend.some((bucket) => bucket.total)) {
    return (
      <div className="empty-state">
        <p>No executions were recorded in this time window.</p>
        <p>Choose a wider preset or create a deterministic run from the executions page.</p>
      </div>
    );
  }
  return (
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
            <span className="trend-danger" style={{ width: `${(bucket.failed / max) * 100}%` }} />
          </div>
          <span className="mono">{bucket.total}</span>
        </li>
      ))}
    </ol>
  );
}

function ActiveFilters({ params }: { params: URLSearchParams }) {
  const keys = ["q", "status", "provider", "model", "errorCategory", "errorCode", "signal"];
  const active = keys.flatMap((key) => params.getAll(key).map((value) => ({ key, value })));
  if (!active.length) return null;
  return (
    <div className="active-filters" aria-label="Active filters">
      {active.map(({ key, value }) => (
        <Link href={withoutParam(params, key)} key={`${key}-${value}`}>
          {key}: {value} <span aria-hidden="true">×</span>
          <span className="sr-only">remove filter</span>
        </Link>
      ))}
      <Link href={`/investigations?window=${params.get("window") ?? "24h"}`}>Clear all</Link>
    </div>
  );
}

function resolveRange(params: WorkbenchSearchParams) {
  const from = first(params.from);
  const to = first(params.to);
  if (from && to) {
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }
  const requestedPreset = first(params.window);
  const preset: WindowPreset = isWindowPreset(requestedPreset) ? requestedPreset : "24h";
  const end = new Date();
  return { from: new Date(end.getTime() - PRESET_MS[preset]).toISOString(), to: end.toISOString() };
}

function isWindowPreset(value: string | undefined): value is WindowPreset {
  return value === "1h" || value === "24h" || value === "7d" || value === "30d";
}

function copyFilters(source: URLSearchParams, target: URLSearchParams, keys: string[]) {
  for (const key of keys)
    for (const value of source.getAll(key)) if (value.trim()) target.append(key, value);
}

function toUrlSearchParams(params: WorkbenchSearchParams) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value ? [value] : [])
      if (item.trim()) result.append(key, item);
  }
  return result;
}

function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function all(value: SearchValue): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function filterHref(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.set(key, value);
  return `/investigations?${next.toString()}#execution-explorer`;
}

function routeHref(params: URLSearchParams, provider: string, model: string) {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.set("provider", provider);
  next.set("model", model);
  return `/investigations?${next.toString()}#execution-explorer`;
}

function withoutParam(params: URLSearchParams, key: string) {
  const next = new URLSearchParams(params);
  next.delete(key);
  next.delete("cursor");
  return `/investigations${next.size ? `?${next.toString()}` : ""}#execution-explorer`;
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatLatency(value: number | null) {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function shortDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
  });
}
