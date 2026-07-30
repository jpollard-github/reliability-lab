import type { ConclusionReadiness as ConclusionReadinessModel } from "@reliability-lab/contracts";

export function ConclusionReadiness({ readiness }: { readiness: ConclusionReadinessModel }) {
  return (
    <section
      aria-labelledby="conclusion-readiness-heading"
      className={`panel conclusion-readiness ${readiness.ready ? "readiness-ready" : ""}`}
    >
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Record completeness</p>
          <h2 id="conclusion-readiness-heading">Conclusion readiness</h2>
          <p>
            {readiness.ready
              ? "The required case record is complete enough to resolve."
              : "Complete the unsatisfied requirements before resolving the case."}
          </p>
        </div>
        <strong className="readiness-state">{readiness.ready ? "Ready" : "Not ready"}</strong>
      </div>
      <p className="readiness-caveat">
        Readiness does not prove factual correctness, causation, or conclusion truth.
      </p>
      <ul className="readiness-checks">
        {readiness.checks.map((check) => (
          <li key={check.id}>
            <span aria-hidden="true">{check.satisfied ? "✓" : "○"}</span>
            <div>
              <strong>{check.label}</strong>
              <p>{check.explanation}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
