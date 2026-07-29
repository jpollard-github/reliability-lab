import Link from "next/link";
import type { ExecutionSummary } from "@reliability-lab/contracts";
import { StatusBadge } from "@/components/status-badge";

export function ExecutionTable({
  executions,
  returnTo,
}: {
  executions: ExecutionSummary[];
  returnTo?: string;
}) {
  if (executions.length === 0) {
    return (
      <div className="empty-state">
        <p>No executions recorded for demo-tenant.</p>
        <p>Use the development console to create the first deterministic run.</p>
      </div>
    );
  }
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            <th>Execution</th>
            <th>Status</th>
            <th>Route</th>
            <th>Attempts</th>
            <th>Signals</th>
            <th>Duration</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={execution.executionId}>
              <td>
                <Link
                  className="mono execution-link"
                  href={{
                    pathname: `/executions/${execution.executionId}`,
                    ...(returnTo ? { query: { returnTo } } : {}),
                  }}
                >
                  {execution.executionId.slice(0, 12)}
                </Link>
                {execution.replayOfExecutionId ? <span className="replay-mark">replay</span> : null}
              </td>
              <td>
                <StatusBadge status={execution.status} />
              </td>
              <td>
                {execution.finalProvider ?? execution.initialProvider}
                <span className="muted"> / {execution.finalModel ?? execution.initialModel}</span>
              </td>
              <td>
                {execution.attemptCount}
                {execution.retryCount ? (
                  <span className="muted"> · {execution.retryCount} retries</span>
                ) : null}
              </td>
              <td>
                <div className="signal-list">
                  {execution.signals.length
                    ? execution.signals.map((signal) => (
                        <span className="signal-chip" key={signal}>
                          {signal.replaceAll("_", " ")}
                        </span>
                      ))
                    : "—"}
                </div>
              </td>
              <td>{execution.durationMs === undefined ? "—" : `${execution.durationMs} ms`}</td>
              <td>{new Date(execution.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
