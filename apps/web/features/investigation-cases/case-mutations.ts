"use client";

import type {
  CreateInvestigationCaseComparisonBody,
  InvestigationCaseDetail,
  InvestigationCaseComparisonResult,
  InvestigationCaseEvidenceInput,
} from "@reliability-lab/contracts";
import { requestJson } from "@/lib/client-api";
import { browserApiUrl, browserTenantId, isRecord } from "@/lib/client-api";

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

export async function createInvestigationCaseComparison(
  caseId: string,
  body: CreateInvestigationCaseComparisonBody,
): Promise<{ result: InvestigationCaseComparisonResult }> {
  const response = await fetch(
    `${browserApiUrl}/v1/investigation-cases/${encodeURIComponent(caseId)}/comparisons`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": browserTenantId },
      body: JSON.stringify(body),
    },
  );
  const payload = (await response.json().catch(() => null)) as unknown;
  if ((response.status === 202 || response.status === 409) && isRecord(payload)) {
    return payload as { result: InvestigationCaseComparisonResult };
  }
  const message =
    isRecord(payload) && typeof payload.message === "string"
      ? payload.message
      : `Case comparison failed with HTTP ${response.status}`;
  throw new Error(message);
}

export async function downloadInvestigationCaseReviewPacket(caseId: string): Promise<void> {
  const response = await fetch(
    `${browserApiUrl}/v1/investigation-cases/${encodeURIComponent(caseId)}/review-packet`,
    { headers: { "x-tenant-id": browserTenantId } },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as unknown;
    const message =
      isRecord(body) && typeof body.message === "string"
        ? body.message
        : `Review packet failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = packetFilename(response.headers.get("content-disposition"), caseId);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function packetFilename(disposition: string | null, caseId: string): string {
  const headerName = disposition?.match(/filename="([^"]+)"/iu)?.[1];
  const candidate = headerName ?? `reliability-case-${caseId}.md`;
  return candidate.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 160);
}
