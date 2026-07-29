"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  InvestigationCaseEvidenceInput,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";
import { addInvestigationCaseEvidence, createInvestigationCase } from "./case-mutations";

export function CreateCaseForm({
  scope,
  visibleExecutionIds = [],
  initialEvidence = [],
  optionalEvidence = [],
}: {
  scope: SavedInvestigationScope;
  visibleExecutionIds?: string[];
  initialEvidence?: InvestigationCaseEvidenceInput[];
  optionalEvidence?: Array<{ label: string; evidence: InvestigationCaseEvidenceInput }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "");
    const question = String(form.get("question") ?? "");
    const importance = String(form.get("importance") ?? "");
    const selectedExecutions = form.getAll("executionId").map(String);
    const selectedOptionalEvidence = form
      .getAll("optionalEvidence")
      .map(String)
      .flatMap((index) => optionalEvidence[Number(index)]?.evidence ?? []);
    try {
      const detail = await createInvestigationCase({
        title,
        question,
        ...(importance ? { importance } : {}),
        savedScope: scope,
      });
      const evidence: InvestigationCaseEvidenceInput[] = [
        ...initialEvidence,
        ...selectedOptionalEvidence,
        ...selectedExecutions.map((executionId): InvestigationCaseEvidenceInput => ({
          type: "execution",
          executionId,
        })),
      ];
      for (const item of evidence) {
        try {
          await addInvestigationCaseEvidence(detail.case.caseId, item);
        } catch {
          throw new Error("Case was saved, but one evidence link failed");
        }
      }
      router.push(`/investigation-cases/${detail.case.caseId}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Investigation case could not be saved");
      setBusy(false);
    }
  }

  return (
    <form className="case-create-form" onSubmit={submit}>
      <div className="case-form-grid">
        <label>
          Case title
          <input maxLength={200} name="title" required />
        </label>
        <label>
          Importance
          <select defaultValue="" name="importance">
            <option value="">Not set</option>
            <option value="routine">Routine</option>
            <option value="notable">Notable</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
      </div>
      <label>
        Reliability question
        <textarea maxLength={2000} name="question" required rows={3} />
      </label>
      <div className="saved-range">
        <strong>Exact saved range</strong>
        <span>
          {new Date(scope.range.from).toLocaleString()} through{" "}
          {new Date(scope.range.to).toLocaleString()}
        </span>
      </div>
      {visibleExecutionIds.length ? (
        <fieldset>
          <legend>Optionally link visible executions</legend>
          <div className="case-execution-options">
            {visibleExecutionIds.map((executionId) => (
              <label key={executionId}>
                <input name="executionId" type="checkbox" value={executionId} />
                <span className="mono">{executionId.slice(0, 12)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {initialEvidence.length ? (
        <p className="muted">
          This case will begin with {initialEvidence.length} selected evidence reference
          {initialEvidence.length === 1 ? "" : "s"}.
        </p>
      ) : null}
      {optionalEvidence.length ? (
        <fieldset>
          <legend>Optionally link the active provider observation</legend>
          {optionalEvidence.map((item, index) => (
            <label key={item.label}>
              <input name="optionalEvidence" type="checkbox" value={index} />
              {item.label}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="case-form-actions">
        <button disabled={busy} type="submit">
          {busy ? "Saving…" : "Save investigation"}
        </button>
        <span aria-live="polite" className="form-message">
          {message}
        </span>
      </div>
    </form>
  );
}
