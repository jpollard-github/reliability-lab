import type { ExecutionStatus } from "@reliability-lab/contracts";

export function StatusBadge({ status }: { status: ExecutionStatus }) {
  return <span className={`status status-${status}`}>{status}</span>;
}
