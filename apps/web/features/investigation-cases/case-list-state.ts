import type { InvestigationCaseEvidenceInput } from "@reliability-lab/contracts";

export type SearchValue = string | string[] | undefined;

export function caseListQuery(raw: Record<string, SearchValue>): URLSearchParams {
  const query = new URLSearchParams();
  for (const key of ["cursor", "status", "importance", "q", "executionId"] as const) {
    const value = first(raw[key]);
    if (value) query.set(key, value);
  }
  query.set("limit", "25");
  return query;
}

export function evidenceFromParams(
  params: Record<string, SearchValue>,
): InvestigationCaseEvidenceInput[] {
  const type = first(params.newEvidenceType);
  const id = first(params.newEvidenceId);
  if (type === "execution" && id) return [{ type, executionId: id }];
  if (type === "comparison" && id) return [{ type, experimentId: id }];
  return [];
}

export function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function withoutCursor(params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.delete("limit");
  return `/investigation-cases${next.size ? `?${next.toString()}` : ""}`;
}

export function withCursor(params: URLSearchParams, cursor: string): string {
  const next = new URLSearchParams(params);
  next.delete("limit");
  next.set("cursor", cursor);
  return `/investigation-cases?${next.toString()}`;
}
