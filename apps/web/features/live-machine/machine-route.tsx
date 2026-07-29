import type { ExecutionMachineProjection } from "./execution-machine";

export function MachineRoute({
  projection,
  playbackActive,
  latestVisibleSequence,
}: {
  projection: ExecutionMachineProjection;
  playbackActive: boolean;
  latestVisibleSequence: number;
}) {
  return (
    <ol className="machine-route" aria-label="Execution state route">
      {projection.steps.map((step) => (
        <li
          key={step.id}
          className={`machine-step machine-${step.kind} tone-${step.tone}`}
          aria-current={
            !playbackActive && step.sequence === latestVisibleSequence ? "step" : undefined
          }
        >
          <div className="machine-step-heading">
            <span className="step-sequence mono">#{step.sequence}</span>
            <strong>{step.title}</strong>
            {step.attemptNumber ? (
              <span className="step-attempt">Attempt {step.attemptNumber}</span>
            ) : null}
          </div>
          <p>{step.detail}</p>
          <time dateTime={step.occurredAt}>{new Date(step.occurredAt).toLocaleTimeString()}</time>
        </li>
      ))}
    </ol>
  );
}
