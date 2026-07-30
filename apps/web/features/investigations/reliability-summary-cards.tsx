import Link from "next/link";
import type { ReliabilitySummary } from "@reliability-lab/contracts";
import { filterHref } from "./search-state";

export function ReliabilitySummaryCards({
  summary,
  current,
}: {
  summary: ReliabilitySummary;
  current: URLSearchParams;
}) {
  const cards = [
    {
      href: filterHref(current, "status", "succeeded"),
      label: "Success rate",
      note: `${summary.outcomes.succeeded} of ${summary.population.terminal} terminal`,
      tone: "success",
      value: formatRate(summary.outcomes.successRate),
    },
    {
      href: filterHref(current, "status", "degraded"),
      label: "Degraded",
      note: "terminal executions",
      tone: "warning",
      value: String(summary.outcomes.degraded),
    },
    {
      href: filterHref(current, "status", "failed"),
      label: "Failed",
      note: "terminal executions",
      tone: "danger",
      value: String(summary.outcomes.failed),
    },
    {
      href: filterHref(current, "signal", "retry_recovered"),
      label: "Retry recovered",
      note: "event-derived",
      value: String(summary.signals.retryRecovered),
    },
    {
      href: filterHref(current, "signal", "fallback_used"),
      label: "Fallback dependent",
      note: "event-derived",
      value: String(summary.signals.fallbackUsed),
    },
    {
      href: filterHref(current, "signal", "latency_budget_exceeded"),
      label: "Latency budget",
      note: "exceeded",
      value: String(summary.signals.latencyBudgetExceeded),
    },
    {
      href: filterHref(current, "signal", "structured_output_rejected"),
      label: "Schema rejected",
      note: "structured output",
      value: String(summary.signals.structuredOutputRejected),
    },
    {
      href: filterHref(current, "signal", "provider_outcome_ambiguous"),
      label: "Ambiguous outcome",
      note: "provider-call evidence",
      tone: "danger",
      value: String(summary.signals.providerOutcomeAmbiguous),
    },
    {
      href: filterHref(current, "errorCategory", "provider_unavailable"),
      label: "Provider unavailable",
      note: "generic normalized category",
      tone: "danger",
      value: String(summary.signals.providerUnavailableFailures),
    },
    {
      href: "#execution-explorer",
      label: "p95 latency",
      note: `${summary.latency.sampleSize} terminal samples`,
      value: formatLatency(summary.latency.p95Ms),
    },
  ];
  return (
    <section
      className="investigation-cards"
      aria-label="Reliability summary"
      data-guide-anchor="workbench-summary"
    >
      {cards.map((card) => (
        <DrillCard key={card.label} {...card} />
      ))}
    </section>
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

export function formatRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function formatLatency(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}
