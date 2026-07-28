import Link from "next/link";
import { ExecutionForm } from "@/components/execution-form";
import { ExecutionTable } from "@/components/execution-table";
import { getInvestigationSummary, searchInvestigationExecutions } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [executionPage, summary] = await Promise.all([
    searchInvestigationExecutions(),
    getInvestigationSummary(),
  ]);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Execution control plane</p>
          <h1>Reliability executions</h1>
          <p>Watch policy decisions, normalized failures, and deterministic replays.</p>
        </div>
        <div className="environment-pill">
          <span />
          local · demo-tenant
        </div>
      </section>
      <section className="metrics" aria-label="Execution summary">
        <Metric label="Total" value={summary.population.total} />
        <Metric label="Succeeded" value={summary.outcomes.succeeded} tone="success" />
        <Metric label="Degraded" value={summary.outcomes.degraded} tone="warning" />
        <Metric label="Failed" value={summary.outcomes.failed} tone="danger" />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Development console</h2>
            <p>
              Runs use the deterministic fake provider. Failure injection must be enabled in the
              API.
            </p>
          </div>
        </div>
        <ExecutionForm />
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent executions</h2>
            <p>Compact tenant-isolated results from the last 24 hours, newest first.</p>
          </div>
          <Link className="workbench-link" href="/investigations">
            Open investigation workbench
          </Link>
        </div>
        <ExecutionTable executions={executionPage.data} />
      </section>
    </>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
