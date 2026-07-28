"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  InvestigationCaseEvidenceInput,
  InvestigationCaseSummary,
} from "@reliability-lab/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const tenantId = process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "demo-tenant";

export function AddToCase({
  cases,
  evidence,
  beginCaseHref,
}: {
  cases: InvestigationCaseSummary[];
  evidence: InvestigationCaseEvidenceInput;
  beginCaseHref: string;
}) {
  const [caseId, setCaseId] = useState(cases[0]?.case.caseId ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function add() {
    if (!caseId) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(
        `${apiUrl}/v1/investigation-cases/${encodeURIComponent(caseId)}/evidence`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-tenant-id": tenantId },
          body: JSON.stringify(evidence),
        },
      );
      if (!response.ok) throw new Error(`Evidence link failed with HTTP ${response.status}`);
      const result = (await response.json()) as { added: boolean };
      setMessage(result.added ? "Evidence linked." : "Evidence was already linked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Evidence could not be linked");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel add-to-case" aria-labelledby="add-to-case-heading">
      <div>
        <h2 id="add-to-case-heading">Add to investigation case</h2>
        <p>Link this evidence without copying its prompt, output, attempts, or events.</p>
      </div>
      <div className="add-to-case-controls">
        <label>
          Recent active case
          <select
            disabled={!cases.length}
            onChange={(event) => setCaseId(event.target.value)}
            value={caseId}
          >
            {cases.length ? (
              cases.map((item) => (
                <option key={item.case.caseId} value={item.case.caseId}>
                  {item.case.title}
                </option>
              ))
            ) : (
              <option value="">No active cases</option>
            )}
          </select>
        </label>
        <button disabled={busy || !caseId} onClick={() => void add()} type="button">
          {busy ? "Adding…" : "Add evidence"}
        </button>
        <Link href={beginCaseHref}>Begin a new case</Link>
      </div>
      <span aria-live="polite" className="form-message">
        {message}
      </span>
    </section>
  );
}
