import Link from "next/link";
import { notFound } from "next/navigation";
import { ComparisonConfigurations } from "@/features/comparisons/comparison-configurations";
import { ComparisonMachines } from "@/features/comparisons/comparison-machines";
import { ComparisonSummary } from "@/features/comparisons/comparison-summary";
import { AddToCase } from "@/features/investigation-cases/add-to-case";
import { ConceptHelp } from "@/features/guidance/concept-help";
import { getComparison, getInvestigationCases } from "@/lib/server-api";

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
  const { experiment, originalExecution, variantExecution } = comparison;

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
        <div className="comparison-links" data-guide-anchor="comparison-source-links">
          <Link href={`/executions/${originalExecution.executionId}`}>Original detail</Link>
          {variantExecution ? (
            <Link href={`/executions/${variantExecution.executionId}`}>Variant detail</Link>
          ) : null}
        </div>
      </section>
      <ConceptHelp
        title="How should I interpret this comparison?"
        what="Comparative Replay keeps retained input fixed and creates a normal variant execution from a bounded configuration change."
        why="Named dimensions preserve tradeoffs that a universal score would hide."
        lookFor="Compare resolved conditions, follow both recorded machines, and open either source execution when a dimension needs more evidence."
      />

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

      <ComparisonConfigurations comparison={comparison} />
      <ComparisonMachines comparison={comparison} />
      <ComparisonSummary comparison={comparison} />
    </>
  );
}
