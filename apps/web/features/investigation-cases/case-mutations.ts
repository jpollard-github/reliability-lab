"use client";

import type {
  InvestigationCaseDetail,
  InvestigationCaseEvidenceInput,
} from "@reliability-lab/contracts";
import { requestJson } from "@/lib/client-api";

interface CaseUpdateDraft {
  title: string;
  question: string;
  status: string;
  importance: string | null;
  finding: string | null;
  resolution: string | null;
}

export function createInvestigationCase(body: {
  title: string;
  question: string;
  importance?: string;
  savedScope: InvestigationCaseDetail["case"]["savedScope"];
}): Promise<InvestigationCaseDetail> {
  return requestJson("/v1/investigation-cases", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateInvestigationCase(caseId: string, body: CaseUpdateDraft): Promise<unknown> {
  return requestJson(`/v1/investigation-cases/${encodeURIComponent(caseId)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function addInvestigationCaseNote(caseId: string, body: string): Promise<unknown> {
  return requestJson(`/v1/investigation-cases/${encodeURIComponent(caseId)}/notes`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function addInvestigationCaseEvidence(
  caseId: string,
  evidence: InvestigationCaseEvidenceInput,
): Promise<{ added: boolean }> {
  return requestJson(`/v1/investigation-cases/${encodeURIComponent(caseId)}/evidence`, {
    method: "POST",
    body: JSON.stringify(evidence),
  });
}

export function removeInvestigationCaseEvidence(
  caseId: string,
  evidenceId: string,
): Promise<unknown> {
  return requestJson(
    `/v1/investigation-cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`,
    { method: "DELETE" },
  );
}
