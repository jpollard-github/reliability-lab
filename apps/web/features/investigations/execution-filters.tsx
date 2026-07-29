import Link from "next/link";
import {
  activeFilterDescriptions,
  all,
  first,
  type WindowPreset,
  type WorkbenchSearchParams,
} from "./search-state";

export function ExecutionFilters({
  raw,
  current,
  selectedWindow,
}: {
  raw: WorkbenchSearchParams;
  current: URLSearchParams;
  selectedWindow: WindowPreset;
}) {
  const active = activeFilterDescriptions(current);
  return (
    <>
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
            {["queued", "running", "succeeded", "degraded", "failed", "cancelled"].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
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
      {active.length ? (
        <div className="active-filters" aria-label="Active filters">
          {active.map(({ key, value, label, href }) => (
            <Link href={href} key={`${key}-${value}`}>
              {label} <span aria-hidden="true">×</span>
              <span className="sr-only">remove filter</span>
            </Link>
          ))}
          <Link href={`/investigations?window=${current.get("window") ?? "24h"}`}>Clear all</Link>
        </div>
      ) : null}
    </>
  );
}
