import "server-only";

import type {
  ComparisonView,
  ExecutionEnvelope,
  ExecutionSummaryPage,
  InvestigationCaseDetail,
  InvestigationCasePage,
  InvestigationCaseReview,
  ProviderObservationPage,
  ReliabilitySummary,
} from "@reliability-lab/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const tenantId = process.env.DEMO_TENANT_ID ?? "demo-tenant";

export async function searchInvestigationExecutions(
  params: URLSearchParams = new URLSearchParams(),
): Promise<ExecutionSummaryPage> {
  return getInvestigationResponse<ExecutionSummaryPage>("executions", params);
}

export async function getInvestigationSummary(
  params: URLSearchParams = new URLSearchParams(),
): Promise<ReliabilitySummary> {
  return getInvestigationResponse<ReliabilitySummary>("summary", params);
}

export async function getProviderObservations(
  params: URLSearchParams = new URLSearchParams(),
): Promise<ProviderObservationPage> {
  return getInvestigationResponse<ProviderObservationPage>("providers", params);
}

export async function getExecution(executionId: string): Promise<ExecutionEnvelope | null> {
  const response = await fetch(`${apiUrl}/v1/executions/${encodeURIComponent(executionId)}`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Execution detail failed with HTTP ${response.status}`);
  return (await response.json()) as ExecutionEnvelope;
}

export async function getComparison(experimentId: string): Promise<ComparisonView | null> {
  const response = await fetch(`${apiUrl}/v1/comparisons/${encodeURIComponent(experimentId)}`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Comparison detail failed with HTTP ${response.status}`);
  return (await response.json()) as ComparisonView;
}

export async function getInvestigationCases(
  params: URLSearchParams = new URLSearchParams(),
): Promise<InvestigationCasePage> {
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${apiUrl}/v1/investigation-cases${query}`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Investigation case list failed with HTTP ${response.status}`);
  return (await response.json()) as InvestigationCasePage;
}

export async function getInvestigationCase(
  caseId: string,
): Promise<InvestigationCaseDetail | null> {
  const response = await fetch(`${apiUrl}/v1/investigation-cases/${encodeURIComponent(caseId)}`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Investigation case detail failed with HTTP ${response.status}`);
  return (await response.json()) as InvestigationCaseDetail;
}

export async function getInvestigationCaseReview(
  caseId: string,
): Promise<InvestigationCaseReview | null> {
  const response = await fetch(
    `${apiUrl}/v1/investigation-cases/${encodeURIComponent(caseId)}/review`,
    {
      headers: { "x-tenant-id": tenantId },
      cache: "no-store",
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Investigation case review failed with HTTP ${response.status}`);
  return (await response.json()) as InvestigationCaseReview;
}

async function getInvestigationResponse<T>(
  resource: "executions" | "summary" | "providers",
  params: URLSearchParams,
): Promise<T> {
  const query = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${apiUrl}/v1/investigations/${resource}${query}`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`Investigation ${resource} failed with HTTP ${response.status}`);
  return (await response.json()) as T;
}
