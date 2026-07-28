import Link from "next/link";
import { notFound } from "next/navigation";
import { LiveExecutionView } from "@/components/live-execution-view";
import { ReplayButton } from "@/components/replay-button";
import { StatusBadge } from "@/components/status-badge";
import { getExecution } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ExecutionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ executionId: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  const { executionId } = await params;
  const rawReturnTo = (await searchParams).returnTo;
  const requestedReturnTo = Array.isArray(rawReturnTo) ? rawReturnTo[0] : rawReturnTo;
  const returnTo =
    requestedReturnTo?.startsWith("/investigations") === true ? requestedReturnTo : "/";
  const execution = await getExecution(executionId);
  if (!execution) notFound();
  const signals = executionSignals(execution);

  return (
    <>
      <div className="breadcrumb">
        <Link href={returnTo}>{returnTo === "/" ? "Executions" : "Investigation results"}</Link>
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
        <ReplayButton
          executionId={execution.executionId}
          execution={execution}
          capability={execution.replayCapability}
        />
      </section>
      <LiveExecutionView
        key={`${execution.executionId}-${execution.status}-${execution.updatedAt}`}
        initialExecution={execution}
      />
      <section className="detail-grid">
        <div className="panel facts">
          <h2>Envelope</h2>
          <dl>
            <Fact label="Tenant" value={execution.tenantId} />
            <Fact label="Trace ID (copyable)" value={execution.traceId} mono />
            <Fact label="Request hash" value={execution.requestHash} mono />
            <Fact label="Attempts" value={String(execution.attempts.length)} />
            <Fact
              label="Duration"
              value={execution.durationMs === undefined ? "—" : `${execution.durationMs} ms`}
            />
            <Fact label="Created" value={new Date(execution.createdAt).toLocaleString()} />
            <Fact
              label="Replay state"
              value={execution.replayCapability.state.replaceAll("_", " ")}
            />
            <Fact label="Replay detail" value={execution.replayCapability.reason} />
            {execution.replayCapability.expiresAt ? (
              <Fact
                label="Expires"
                value={new Date(execution.replayCapability.expiresAt).toLocaleString()}
              />
            ) : null}
            {execution.replayCapability.deletedAt ? (
              <Fact
                label="Deleted"
                value={new Date(execution.replayCapability.deletedAt).toLocaleString()}
              />
            ) : null}
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
            <h2>Investigation signals</h2>
            <p>Derived from persisted attempts, events, and replay lineage.</p>
          </div>
        </div>
        <div className="signal-detail">
          {signals.length ? (
            signals.map((signal) => (
              <span className="signal-chip" key={signal}>
                {signal.replaceAll("_", " ")}
              </span>
            ))
          ) : (
            <span className="muted">No investigation signals were observed.</span>
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
    </>
  );
}

function executionSignals(execution: NonNullable<Awaited<ReturnType<typeof getExecution>>>) {
  const types = new Set(execution.events.map((event) => event.type));
  return [
    ...(types.has("retry.scheduled") &&
    (execution.status === "succeeded" || execution.status === "degraded")
      ? ["retry_recovered"]
      : []),
    ...(types.has("fallback.selected") ? ["fallback_used"] : []),
    ...(execution.events.some(
      (event) => event.type === "budget.exceeded" && event.budget === "latency",
    )
      ? ["latency_budget_exceeded"]
      : []),
    ...(types.has("structured_output.rejected") ? ["structured_output_rejected"] : []),
    ...(types.has("attempt.outcome_ambiguous") ? ["provider_outcome_ambiguous"] : []),
    ...(execution.replayOfExecutionId ? ["replay_derived"] : []),
  ];
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
