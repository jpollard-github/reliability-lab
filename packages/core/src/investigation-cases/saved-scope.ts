import type { InvestigationRange, SavedInvestigationScope } from "@reliability-lab/contracts";
import { canonicalArray, exactRange } from "./validation.js";

/**
 * Canonicalizes exact Workbench scope snapshots and reconstructs stable Workbench URLs.
 * Moving presets, cursors, limits, and presentation anchors are deliberately not persisted.
 */
export function canonicalizeSavedScope(input: SavedInvestigationScope): SavedInvestigationScope {
  const query = input.query?.trim();
  const providers = canonicalArray(input.providers);
  const models = canonicalArray(input.models);
  const statuses = canonicalArray(input.statuses);
  const errorCode = input.errorCode?.trim();
  return {
    range: exactRange(input.range),
    ...(query ? { query } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(providers.length ? { providers } : {}),
    ...(models.length ? { models } : {}),
    ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  };
}

export function savedScopeFromWorkbenchState(
  input: Record<string, string | string[] | undefined>,
  range: InvestigationRange,
): SavedInvestigationScope {
  const values = (key: string) => {
    const value = input[key];
    return (Array.isArray(value) ? value : value ? [value] : []).flatMap((item) => item.split(","));
  };
  return canonicalizeSavedScope({
    range,
    ...(values("q")[0] ? { query: values("q")[0] } : {}),
    ...(values("status").length
      ? {
          statuses: values("status") as NonNullable<SavedInvestigationScope["statuses"]>,
        }
      : {}),
    ...(values("provider").length ? { providers: values("provider") } : {}),
    ...(values("model").length ? { models: values("model") } : {}),
    ...(values("errorCategory")[0]
      ? {
          errorCategory: values("errorCategory")[0] as NonNullable<
            SavedInvestigationScope["errorCategory"]
          >,
        }
      : {}),
    ...(values("errorCode")[0] ? { errorCode: values("errorCode")[0] } : {}),
    ...(values("signal")[0]
      ? {
          signal: values("signal")[0] as NonNullable<SavedInvestigationScope["signal"]>,
        }
      : {}),
  });
}

export function savedScopeToWorkbenchUrl(scope: SavedInvestigationScope): string {
  const canonical = canonicalizeSavedScope(scope);
  const params = new URLSearchParams({
    from: canonical.range.from,
    to: canonical.range.to,
  });
  if (canonical.query) params.set("q", canonical.query);
  for (const status of canonical.statuses ?? []) params.append("status", status);
  for (const provider of canonical.providers ?? []) params.append("provider", provider);
  for (const model of canonical.models ?? []) params.append("model", model);
  if (canonical.errorCategory) params.set("errorCategory", canonical.errorCategory);
  if (canonical.errorCode) params.set("errorCode", canonical.errorCode);
  if (canonical.signal) params.set("signal", canonical.signal);
  return `/investigations?${params.toString()}#execution-explorer`;
}
