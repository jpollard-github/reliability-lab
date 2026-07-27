import { ExecutionForm } from "@/components/execution-form";
import { ExecutionTable } from "@/components/execution-table";
import { listExecutions } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const executions = await listExecutions();
  const succeeded = executions.filter((execution) => execution.status === "succeeded").length;
  const degraded = executions.filter((execution) => execution.status === "degraded").length;
  const failed = executions.filter((execution) => execution.status === "failed").length;

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Execution control plane</p>
          <h1>Incident runs</h1>
          <p>Inspect policy decisions, normalized failures, and deterministic replays.</p>
        </div>
        <div className="environment-pill">
          <span />
          local · demo-tenant
        </div>
      </section>
      <section className="metrics" aria-label="Execution summary">
        <Metric label="Total" value={executions.length} />
        <Metric label="Succeeded" value={succeeded} tone="success" />
        <Metric label="Degraded" value={degraded} tone="warning" />
        <Metric label="Failed" value={failed} tone="danger" />
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
            <p>Tenant-isolated results, newest first.</p>
          </div>
          <span className="muted">{executions.length} records</span>
        </div>
        <ExecutionTable executions={executions} />
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
