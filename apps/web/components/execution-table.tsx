import Link from "next/link";
import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import { StatusBadge } from "./status-badge";

export function ExecutionTable({ executions }: { executions: ExecutionEnvelope[] }) {
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
            <th>Tenant</th>
            <th>Route</th>
            <th>Attempts</th>
            <th>Duration</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={execution.executionId}>
              <td>
                <Link className="mono execution-link" href={`/executions/${execution.executionId}`}>
                  {execution.executionId.slice(0, 12)}
                </Link>
                {execution.replayOfExecutionId ? <span className="replay-mark">replay</span> : null}
              </td>
              <td>
                <StatusBadge status={execution.status} />
              </td>
              <td>{execution.tenantId}</td>
              <td>
                {execution.provider}
                <span className="muted"> / {execution.model}</span>
              </td>
              <td>{execution.attempts.length}</td>
              <td>{execution.durationMs === undefined ? "—" : `${execution.durationMs} ms`}</td>
              <td>{new Date(execution.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
