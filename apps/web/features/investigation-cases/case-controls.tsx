"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type {
  InvestigationCaseDetail,
  InvestigationCaseEvidenceInput,
} from "@reliability-lab/contracts";
import { CaseEvidence } from "./case-evidence";
import {
  addInvestigationCaseEvidence,
  addInvestigationCaseNote,
  removeInvestigationCaseEvidence,
  updateInvestigationCase,
} from "./case-mutations";

export function CaseControls({ detail }: { detail: InvestigationCaseDetail }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function mutate(operation: string, action: () => Promise<unknown>) {
    setBusy(operation);
    setMessage("");
    try {
      await action();
      setMessage(`${operation} complete.`);
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${operation} failed`);
      return false;
    } finally {
      setBusy("");
    }
  }

  async function updateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("Case update", () =>
      updateInvestigationCase(detail.case.caseId, {
        title: String(form.get("title") ?? ""),
        question: String(form.get("question") ?? ""),
        status: String(form.get("status") ?? ""),
        importance: String(form.get("importance") ?? "") || null,
        finding: String(form.get("finding") ?? "") || null,
        resolution: String(form.get("resolution") ?? "") || null,
      }),
    );
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await mutate("Note addition", () =>
      addInvestigationCaseNote(detail.case.caseId, String(data.get("body") ?? "")),
    );
    if (ok) form.reset();
  }

  async function addEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const type = String(data.get("type"));
    let evidence: InvestigationCaseEvidenceInput;
    if (type === "execution") {
      evidence = { type, executionId: String(data.get("referenceId") ?? "") };
    } else if (type === "comparison") {
      evidence = { type, experimentId: String(data.get("referenceId") ?? "") };
    } else {
      evidence = {
        type: "provider_observation",
        provider: String(data.get("provider") ?? ""),
        model: String(data.get("model") ?? ""),
        range: detail.case.savedScope.range,
      };
    }
    const ok = await mutate("Evidence addition", () =>
      addInvestigationCaseEvidence(detail.case.caseId, evidence),
    );
    if (ok) form.reset();
  }

  return (
    <>
      <section
        className="panel"
        aria-labelledby="case-update-heading"
        data-guide-anchor="case-controls"
      >
        <div className="panel-heading">
          <div>
            <h2 id="case-update-heading">Current interpretation</h2>
            <p>Current fields may evolve; timeline entries preserve metadata about the change.</p>
          </div>
        </div>
        <form className="case-edit-form" onSubmit={updateCase}>
          <div className="case-form-grid">
            <label>
              Title
              <input defaultValue={detail.case.title} maxLength={200} name="title" required />
            </label>
            <label>
              Status
              <select defaultValue={detail.case.status} name="status">
                <option value="open">Open</option>
                <option value="investigating">Investigating</option>
                <option value="resolved">Resolved</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label>
              Importance
              <select defaultValue={detail.case.importance ?? ""} name="importance">
                <option value="">Not set</option>
                <option value="routine">Routine</option>
                <option value="notable">Notable</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <label>
            Question
            <textarea
              defaultValue={detail.case.question}
              maxLength={2000}
              name="question"
              required
              rows={3}
            />
          </label>
          <label>
            Current finding
            <textarea
              defaultValue={detail.case.finding ?? ""}
              maxLength={10000}
              name="finding"
              rows={4}
            />
          </label>
          <label>
            Resolution
            <textarea
              defaultValue={detail.case.resolution ?? ""}
              maxLength={10000}
              name="resolution"
              rows={4}
            />
          </label>
          <button disabled={Boolean(busy)} type="submit">
            Update case
          </button>
        </form>
      </section>

      <section className="case-two-column">
        <form className="panel case-edit-form" onSubmit={addNote}>
          <h2>Add append-only note</h2>
          <p>A correction is a new note; existing notes cannot be edited or deleted.</p>
          <label>
            Note
            <textarea maxLength={5000} name="body" required rows={5} />
          </label>
          <button disabled={Boolean(busy)} type="submit">
            Add note
          </button>
        </form>
        <form className="panel case-edit-form" onSubmit={addEvidence}>
          <h2>Add evidence reference</h2>
          <p>References remain current; execution contents are not copied into this case.</p>
          <label>
            Evidence type
            <select defaultValue="execution" name="type">
              <option value="execution">Execution</option>
              <option value="comparison">Comparison</option>
              <option value="provider_observation">Provider observation</option>
            </select>
          </label>
          <label>
            Execution or comparison ID
            <input name="referenceId" />
          </label>
          <div className="case-form-grid">
            <label>
              Provider
              <input name="provider" placeholder="fake-primary" />
            </label>
            <label>
              Model
              <input name="model" placeholder="deterministic-v1" />
            </label>
          </div>
          <button disabled={Boolean(busy)} type="submit">
            Add evidence
          </button>
        </form>
      </section>

      <span aria-live="polite" className="form-message">
        {message}
      </span>

      <CaseEvidence
        busy={Boolean(busy)}
        detail={detail}
        removeEvidence={(evidenceId) =>
          void mutate("Evidence removal", () =>
            removeInvestigationCaseEvidence(detail.case.caseId, evidenceId),
          )
        }
      />
    </>
  );
}
