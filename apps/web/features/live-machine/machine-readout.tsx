import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import type { ExecutionMachineProjection } from "./execution-machine";

export function MachineReadout({
  execution,
  projection,
  elapsedMs,
  eventCount,
  playbackActive,
  playbackCount,
}: {
  execution: ExecutionEnvelope;
  projection: ExecutionMachineProjection;
  elapsedMs: number;
  eventCount: number;
  playbackActive: boolean;
  playbackCount: number;
}) {
  return (
    <div className="machine-readout">
      <Readout label="Actual elapsed" value={`${(elapsedMs / 1_000).toFixed(2)} s`} mono />
      <Readout label="Persisted events" value={String(eventCount)} mono />
      <Readout label="Latest sequence" value={`#${projection.latestSequence}`} mono />
      <Readout
        label="Latency budget"
        value={
          execution.budget.maxLatencyMs === undefined
            ? "No limit"
            : `${execution.budget.maxLatencyMs} ms`
        }
        mono
      />
      <Readout
        label="Presentation"
        value={
          playbackActive
            ? `Step ${playbackCount} of ${eventCount}`
            : projection.terminal
              ? "Recorded history"
              : "Live edge"
        }
      />
    </div>
  );
}

function Readout({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <strong className={mono ? "mono" : undefined}>{value}</strong>
    </div>
  );
}
