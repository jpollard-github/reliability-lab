import Link from "next/link";
import { notFound } from "next/navigation";
import type {
  ComparisonChange,
  ExecutionBudget,
  ExecutionPolicy,
} from "@reliability-lab/contracts";
import { ExecutionMachineView } from "@/components/live-execution-view";
import { AddToCase } from "@/components/add-to-case";
import { getComparison, getInvestigationCases } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ComparisonDetailPage({
  params,
}: {
  params: Promise<{ experimentId: string }>;
}) {
  const { experimentId } = await params;
  const recentCaseParams = new URLSearchParams({ limit: "10" });
  recentCaseParams.append("status", "open");
  recentCaseParams.append("status", "investigating");
  const [comparison, recentCases] = await Promise.all([
    getComparison(experimentId),
    getInvestigationCases(recentCaseParams),
  ]);
  if (!comparison) notFound();
  const { experiment, originalExecution, variantExecution, projection } = comparison;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Executions</Link>
        <span>/</span>
        <span>Comparisons</span>
        <span>/</span>
        <span className="mono">{experiment.experimentId}</span>
      </div>
      <section className="detail-heading">
        <div>
          <p className="eyebrow">Comparison experiment v{experiment.schemaVersion}</p>
          <h1 className="mono">{experiment.experimentId}</h1>
          <div className="detail-subtitle">
            <span className={`comparison-status comparison-${experiment.status}`}>
              {experiment.status}
            </span>
            <span>Same retained input · two normal execution envelopes</span>
          </div>
        </div>
        <div className="comparison-links">
          <Link href={`/executions/${originalExecution.executionId}`}>Original detail</Link>
          {variantExecution ? (
            <Link href={`/executions/${variantExecution.executionId}`}>Variant detail</Link>
          ) : null}
        </div>
      </section>

      {experiment.unavailableReason ? (
        <section className="panel comparison-unavailable">
          <h2>Comparison unavailable</h2>
          <p>{experiment.unavailableReason}</p>
        </section>
      ) : null}

      <AddToCase
        beginCaseHref={`/investigation-cases?newEvidenceType=comparison&newEvidenceId=${encodeURIComponent(experiment.experimentId)}`}
        cases={recentCases.data}
        evidence={{ type: "comparison", experimentId: experiment.experimentId }}
      />

      <section className="comparison-configs" aria-label="Execution configurations">
        <ConfigurationCard
          title="Original conditions"
          provider={originalExecution.attempts[0]?.provider ?? originalExecution.provider}
          model={originalExecution.attempts[0]?.model ?? originalExecution.model}
          policy={originalExecution.policy}
          budget={originalExecution.budget}
          structuredOutputRequired={originalExecution.attempts.some(
            (attempt) => attempt.validation !== undefined,
          )}
        />
        <ConfigurationCard
          title="Resolved variant conditions"
          provider={experiment.resolvedVariant.provider}
          model={experiment.resolvedVariant.model}
          policy={experiment.resolvedVariant.policy}
          budget={experiment.resolvedVariant.budget}
          structuredOutputRequired={experiment.resolvedVariant.structuredOutputRequired}
        />
      </section>

      <section className="comparison-machines" aria-label="Side-by-side execution machines">
        <ExecutionMachineView
          initialExecution={originalExecution}
          title="Original machine"
          followLive={false}
        />
        {variantExecution ? (
          <ExecutionMachineView initialExecution={variantExecution} title="Variant machine" />
        ) : (
          <div className="panel empty-state">
            <h2>Variant machine</h2>
            <p>No variant envelope was created.</p>
          </div>
        )}
      </section>

      <section className="panel comparison-summary">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Normalized evidence</p>
            <h2>Comparison summary</h2>
            <p>{projection.summary}</p>
          </div>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Dimension</th>
                <th>Original</th>
                <th>Variant</th>
                <th>Change</th>
                <th>Interpretation</th>
              </tr>
            </thead>
            <tbody>
              {projection.dimensions.map((dimension) => (
                <tr key={dimension.key}>
                  <th scope="row">{dimension.label}</th>
                  <td>{formatValue(dimension.original)}</td>
                  <td>{formatValue(dimension.variant)}</td>
                  <td>
                    <ChangeBadge change={dimension.change} />
                  </td>
                  <td className="comparison-explanation">{dimension.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ConfigurationCard({
  title,
  provider,
  model,
  policy,
  budget,
  structuredOutputRequired,
}: {
  title: string;
  provider: string;
  model: string;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  structuredOutputRequired: boolean;
}) {
  return (
    <article className="panel facts">
      <h2>{title}</h2>
      <dl>
        <Fact label="Provider" value={provider} />
        <Fact label="Model" value={model} />
        <Fact label="Attempts" value={String(policy.maxAttempts)} />
        <Fact label="Backoff" value={`${policy.baseBackoffMs}–${policy.maxBackoffMs} ms`} />
        <Fact label="Jitter" value={String(policy.jitterRatio)} />
        <Fact
          label="Fallback"
          value={
            policy.fallbackProvider
              ? `${policy.fallbackProvider} / ${policy.fallbackModel ?? model}`
              : "none"
          }
        />
        <Fact label="Latency" value={`${budget.maxLatencyMs} ms`} />
        <Fact label="Structured" value={structuredOutputRequired ? "required" : "not requested"} />
      </dl>
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function ChangeBadge({ change }: { change: ComparisonChange }) {
  return <span className={`comparison-change change-${change}`}>{change}</span>;
}

function formatValue(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value);
}
