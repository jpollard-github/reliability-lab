"use client";

import Link from "next/link";
import type { InvestigationCaseDetail } from "@reliability-lab/contracts";

export function CaseEvidence({
  detail,
  busy,
  removeEvidence,
}: {
  detail: InvestigationCaseDetail;
  busy: boolean;
  removeEvidence: (evidenceId: string) => void;
}) {
  return (
    <section
      className="panel"
      aria-labelledby="linked-evidence-heading"
      data-guide-anchor="case-evidence"
    >
      <div className="panel-heading">
        <div>
          <h2 id="linked-evidence-heading">Manage evidence links</h2>
          <p>
            Add or remove associations here. Removing a link keeps the authoritative evidence
            intact.
          </p>
        </div>
      </div>
      {detail.evidence.length ? (
        <ul className="evidence-list">
          {detail.evidence.map((evidence) => (
            <li key={evidence.evidenceId}>
              <div>
                <strong>{evidence.type.replaceAll("_", " ")}</strong>
                <span className="mono">
                  {evidence.type === "execution"
                    ? evidence.executionId
                    : evidence.type === "comparison"
                      ? evidence.experimentId
                      : `${evidence.provider} / ${evidence.model}`}
                </span>
              </div>
              <div>
                <Link href={evidence.url}>Open evidence</Link>
                <button
                  disabled={busy}
                  onClick={() => removeEvidence(evidence.evidenceId)}
                  type="button"
                >
                  Remove link
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <p>No evidence references are linked yet.</p>
        </div>
      )}
    </section>
  );
}
