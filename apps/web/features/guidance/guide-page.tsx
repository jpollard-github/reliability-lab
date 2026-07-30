import Link from "next/link";
import {
  deterministicScenarios,
  glossary,
  honestLimitations,
  operatorWorkflow,
} from "./guide-content";

export function GuidePage() {
  return (
    <>
      <section className="page-heading guide-heading">
        <div>
          <p className="eyebrow">Product tour and operator guidance</p>
          <h1>Reliability Lab guide</h1>
          <p>
            Learn how to execute, explain, replay, compare, investigate, and preserve
            evidence-backed LLM reliability work.
          </p>
        </div>
      </section>

      <section className="panel guide-orientation" aria-labelledby="orientation-heading">
        <div className="guide-promise">
          <p className="eyebrow">Product promise</p>
          <h2 id="orientation-heading">
            Make policy-driven LLM executions observable and replayable
          </h2>
          <p>
            Reliability here means preserving enough normalized, tenant-scoped evidence to explain
            recorded control flow and revisit it. It does not mean that an answer is factually
            correct or that an external provider effect happened exactly once.
          </p>
        </div>

        <section className="guide-boundaries" aria-labelledby="boundaries-heading">
          <h2 id="boundaries-heading">Evidence boundaries</h2>
          <dl className="guide-boundary-grid">
            <div>
              <dt>Execution versus attempt</dt>
              <dd>
                An execution is the policy-governed lifecycle. Each provider call inside it is an
                attempt.
              </dd>
            </div>
            <div>
              <dt>Normalized evidence versus replay input</dt>
              <dd>
                The interface shows normalized outcomes and events. Retained replay input lives in a
                separately governed replay capsule and appears only through current capability.
              </dd>
            </div>
          </dl>
        </section>
      </section>

      <section className="guide-section" aria-labelledby="workflow-heading">
        <div className="guide-section-heading">
          <p className="eyebrow">Operator workflow</p>
          <h2 id="workflow-heading">
            Execute → Explain → Watch → Replay → Compare → Investigate → Preserve
          </h2>
        </div>
        <ol className="guide-workflow">
          {operatorWorkflow.map((stage, index) => (
            <li key={stage.name}>
              <article className="panel">
                <div className="guide-stage-heading">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{stage.name}</h3>
                </div>
                <p>{stage.action}</p>
                <dl>
                  <dt>Inspect</dt>
                  <dd>{stage.evidence}</dd>
                  <dt>Route or control</dt>
                  <dd>
                    <Link href={stage.href}>{stage.control}</Link>
                  </dd>
                  <dt>Can conclude</dt>
                  <dd>{stage.conclusion}</dd>
                  <dt>Cannot conclude</dt>
                  <dd>{stage.nonConclusion}</dd>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <section className="guide-section" aria-labelledby="scenario-heading">
        <div className="guide-section-heading">
          <p className="eyebrow">Deterministic evidence</p>
          <h2 id="scenario-heading">Five scenarios</h2>
          <p>
            Each scenario exercises existing fake-provider behavior; none manufactures tour data.
          </p>
        </div>
        <div className="guide-scenarios">
          {deterministicScenarios.map((scenario) => (
            <article className="panel" key={scenario.id}>
              <h3>{scenario.name}</h3>
              <dl>
                <dt>Expected behavior</dt>
                <dd>{scenario.expected}</dd>
                <dt>Key evidence</dt>
                <dd>{scenario.evidence}</dd>
                <dt>Reliability concept</dt>
                <dd>{scenario.concept}</dd>
                <dt>Suggested next action</dt>
                <dd>{scenario.nextAction}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>

      <section className="guide-section" aria-labelledby="glossary-heading">
        <div className="guide-section-heading">
          <p className="eyebrow">Canonical vocabulary</p>
          <h2 id="glossary-heading">Glossary</h2>
        </div>
        <dl className="guide-glossary panel">
          {glossary.map((entry) => (
            <div key={entry.term}>
              <dt>{entry.term}</dt>
              <dd>{entry.description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="guide-section" aria-labelledby="limitations-heading">
        <div className="guide-section-heading">
          <p className="eyebrow">Honest boundaries</p>
          <h2 id="limitations-heading">What this prototype does not prove</h2>
        </div>
        <ul className="guide-limitations panel">
          {honestLimitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      </section>
    </>
  );
}
