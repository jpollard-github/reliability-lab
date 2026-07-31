"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InvestigationCaseComparisonResult } from "@reliability-lab/contracts";
import { emptyComparisonDraft, toReplayVariation } from "@/features/comparisons/comparison-draft";
import { ComparisonVariationFields } from "@/features/comparisons/comparison-variation-fields";
import { addInvestigationCaseEvidence, createInvestigationCaseComparison } from "./case-mutations";
import type { CaseExperimentCandidate } from "./case-experiment-model";

export function CaseExperimentForm({
  caseId,
  candidates,
}: {
  caseId: string;
  candidates: CaseExperimentCandidate[];
}) {
  const router = useRouter();
  const [executionEvidenceId, setExecutionEvidenceId] = useState(candidates[0]!.evidenceId);
  const [draft, setDraft] = useState(emptyComparisonDraft);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [result, setResult] = useState<InvestigationCaseComparisonResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const createInFlight = useRef(false);
  const recoveryInFlight = useRef(false);
  const baseline =
    candidates.find((candidate) => candidate.evidenceId === executionEvidenceId) ?? candidates[0]!;

  async function createComparison() {
    if (createInFlight.current || result) return;
    createInFlight.current = true;
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await createInvestigationCaseComparison(caseId, {
        executionEvidenceId,
        variation: toReplayVariation(draft),
      });
      setResult(response.result);
      setMessage(
        response.result.kind === "comparison_linked"
          ? response.result.experiment.status === "unavailable"
            ? "The unavailable comparison was preserved and linked as case evidence."
            : "Comparison created and linked to this case."
          : "The comparison exists, but its case evidence link still needs recovery.",
      );
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Comparison could not start");
    } finally {
      createInFlight.current = false;
      setBusy(false);
    }
  }

  async function recoverLink() {
    if (
      recoveryInFlight.current ||
      recovered ||
      !result ||
      result.kind !== "comparison_created_link_failed"
    ) {
      return;
    }
    recoveryInFlight.current = true;
    setRecovering(true);
    setMessage(null);
    try {
      await addInvestigationCaseEvidence(caseId, {
        type: "comparison",
        experimentId: result.recovery.experimentId,
      });
      setRecovered(true);
      setMessage("Existing comparison linked to this case. No second comparison was created.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Existing comparison could not be linked",
      );
    } finally {
      recoveryInFlight.current = false;
      setRecovering(false);
    }
  }

  return (
    <div className="case-experiment-form">
      <label>
        Linked execution
        <select
          value={executionEvidenceId}
          onChange={(event) => {
            setExecutionEvidenceId(event.target.value);
            setDraft(emptyComparisonDraft);
            setResult(null);
            setRecovered(false);
            setMessage(null);
          }}
        >
          {candidates.map((candidate) => (
            <option key={candidate.evidenceId} value={candidate.evidenceId}>
              {candidate.executionId} · {candidate.provider}/{candidate.model}
            </option>
          ))}
        </select>
      </label>
      <p className="form-hint">
        Baseline {baseline.status}; replay {baseline.replayState}. {baseline.replayReason}
      </p>
      <ComparisonVariationFields
        key={executionEvidenceId}
        baseline={baseline}
        draft={draft}
        onChange={setDraft}
      />
      <div className="comparison-submit">
        <span>
          {draft.reproducibilityCheck ? "Explicit same-conditions check" : "Same retained input"}
        </span>
        <button
          type="button"
          onClick={() => void createComparison()}
          disabled={busy || recovering || result !== null}
        >
          {busy ? "Starting…" : "Start controlled comparison"}
        </button>
      </div>
      {message ? (
        <p
          role="status"
          className={
            result?.kind === "comparison_created_link_failed" && !recovered
              ? "form-warning"
              : result
                ? "form-success"
                : "form-error"
          }
        >
          {message}
        </p>
      ) : null}
      {result ? (
        <div className="case-experiment-result">
          <span className="mono">{result.experiment.experimentId}</span>
          <Link href={`/comparisons/${encodeURIComponent(result.experiment.experimentId)}`}>
            Open comparison
          </Link>
          {result.kind === "comparison_created_link_failed" && !recovered ? (
            <button
              type="button"
              className="quiet-button"
              onClick={() => void recoverLink()}
              disabled={recovering || busy}
            >
              {recovering ? "Linking…" : "Link existing comparison to case"}
            </button>
          ) : recovered ? (
            <span>Linked to case</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
