import Link from "next/link";
import { notFound } from "next/navigation";
import { EventTimeline } from "@/components/event-timeline";
import { ReplayButton } from "@/components/replay-button";
import { StatusBadge } from "@/components/status-badge";
import { getExecution } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ExecutionDetailPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  const execution = await getExecution(executionId);
  if (!execution) notFound();

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Executions</Link>
        <span>/</span>
        <span className="mono">{execution.executionId}</span>
      </div>
      <section className="detail-heading">
        <div>
          <p className="eyebrow">Execution envelope v{execution.schemaVersion}</p>
          <h1 className="mono">{execution.executionId}</h1>
          <div className="detail-subtitle">
            <StatusBadge status={execution.status} />
            <span>
              {execution.provider} / {execution.model}
            </span>
            {execution.replayOfExecutionId ? (
              <span>
                replay of{" "}
                <Link href={`/executions/${execution.replayOfExecutionId}`}>
                  {execution.replayOfExecutionId.slice(0, 12)}
                </Link>
              </span>
            ) : null}
          </div>
        </div>
        <ReplayButton executionId={execution.executionId} replayable={execution.replayable} />
      </section>
      <section className="detail-grid">
        <div className="panel facts">
          <h2>Envelope</h2>
          <dl>
            <Fact label="Tenant" value={execution.tenantId} />
            <Fact label="Trace ID" value={execution.traceId} mono />
            <Fact label="Request hash" value={execution.requestHash} mono />
            <Fact label="Attempts" value={String(execution.attempts.length)} />
            <Fact
              label="Duration"
              value={execution.durationMs === undefined ? "—" : `${execution.durationMs} ms`}
            />
            <Fact label="Created" value={new Date(execution.createdAt).toLocaleString()} />
            <Fact
              label="Replay"
              value={
                execution.replayable
                  ? "capsule retained"
                  : (execution.replayUnavailableReason ?? "unavailable")
              }
            />
          </dl>
        </div>
        <div className="panel">
          <h2>Normalized outcome</h2>
          {execution.error ? (
            <div className="error-block">
              <strong>{execution.error.category}</strong>
              <span>{execution.error.code}</span>
              <p>{execution.error.message}</p>
              <small>{execution.error.retryable ? "Retryable" : "Non-retryable"}</small>
            </div>
          ) : (
            <pre className="output">{execution.outputText ?? "No provider output recorded."}</pre>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Attempts</h2>
            <p>Provider calls and normalized outcomes.</p>
          </div>
        </div>
        <div className="attempts">
          {execution.attempts.map((attempt) => (
            <article key={`${attempt.attemptNumber}-${attempt.provider}`}>
              <div>
                <span className="attempt-number">{attempt.attemptNumber}</span>
                <strong>
                  {attempt.provider} / {attempt.model}
                </strong>
              </div>
              <span className={`attempt-status attempt-${attempt.status}`}>{attempt.status}</span>
              <span>{attempt.durationMs === undefined ? "—" : `${attempt.durationMs} ms`}</span>
              <span>
                {attempt.error
                  ? `${attempt.error.category}: ${attempt.error.code}`
                  : `${attempt.usage?.inputTokens ?? 0} in / ${attempt.usage?.outputTokens ?? 0} out`}
              </span>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Event timeline</h2>
            <p>Append-only policy and execution history.</p>
          </div>
          <span className="muted">{execution.events.length} events</span>
        </div>
        <EventTimeline events={execution.events} />
      </section>
    </>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={mono ? "mono truncate" : undefined} title={value}>
        {value}
      </dd>
    </>
  );
}
