import type { ComparisonView, ExecutionEnvelope } from "@reliability-lab/contracts";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const tenantId = process.env.DEMO_TENANT_ID ?? "demo-tenant";

export async function listExecutions(): Promise<ExecutionEnvelope[]> {
  const response = await fetch(`${apiUrl}/v1/executions`, {
    headers: { "x-tenant-id": tenantId },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Execution list failed with HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isRecord(body) || !Array.isArray(body.data))
    throw new Error("Execution list response is invalid");
  return body.data as ExecutionEnvelope[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
