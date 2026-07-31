"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addInvestigationCaseEvidence } from "./case-mutations";

export function CaseComparisonLinkRecovery({
  caseId,
  experimentId,
}: {
  caseId: string;
  experimentId: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function recover() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await addInvestigationCaseEvidence(caseId, {
        type: "comparison",
        experimentId,
      });
      setMessage("Existing comparison linked. No second comparison was created.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Existing comparison could not be linked",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="case-comparison-recovery-action">
      <button type="button" className="quiet-button" onClick={() => void recover()} disabled={busy}>
        {busy ? "Linking…" : "Link existing comparison to case"}
      </button>
      {message ? (
        <p className="form-warning" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
