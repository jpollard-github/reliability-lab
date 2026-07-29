import type {
  InvestigationCaseEvidenceInput,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";

export type SearchValue = string | string[] | undefined;
export type WorkbenchSearchParams = Record<string, SearchValue>;
export type WindowPreset = "1h" | "24h" | "7d" | "30d";
export type ResolvedWorkbenchRange = { from: string; to: string };

export const windowPresets = ["1h", "24h", "7d", "30d"] as const;

const PRESET_MS: Record<WindowPreset, number> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

const filterKeys = [
  "q",
  "status",
  "provider",
  "model",
  "errorCategory",
  "errorCode",
  "signal",
] as const;

export function toUrlSearchParams(params: WorkbenchSearchParams): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of all(value)) {
      if (item.trim()) result.append(key, item);
    }
  }
  return result;
}

export function resolveRange(
  params: WorkbenchSearchParams,
  now = new Date(),
): ResolvedWorkbenchRange {
  const from = first(params.from);
  const to = first(params.to);
  if (from && to) {
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }
  const requestedPreset = first(params.window);
  const preset: WindowPreset = isWindowPreset(requestedPreset) ? requestedPreset : "24h";
  return {
    from: new Date(now.getTime() - PRESET_MS[preset]).toISOString(),
    to: now.toISOString(),
  };
}

export function selectedWindow(params: WorkbenchSearchParams): WindowPreset {
  const requested = first(params.window);
  return isWindowPreset(requested) ? requested : "24h";
}

export function buildApiParams(range: ResolvedWorkbenchRange, current: URLSearchParams) {
  const rangeParams = new URLSearchParams(range);
  const executionParams = new URLSearchParams(rangeParams);
  copyFilters(current, executionParams, [
    "cursor",
    "q",
    "status",
    "provider",
    "model",
    "errorCategory",
    "errorCode",
    "signal",
  ]);
  executionParams.set("limit", "25");
  const providerParams = new URLSearchParams(rangeParams);
  copyFilters(current, providerParams, ["provider", "model"]);
  return { rangeParams, executionParams, providerParams };
}

export function returnUrl(params: URLSearchParams): string {
  return `/investigations${params.size ? `?${params.toString()}` : ""}`;
}

export function filterHref(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.set(key, value);
  return `/investigations?${next.toString()}#execution-explorer`;
}

export function routeHref(params: URLSearchParams, provider: string, model: string): string {
  const next = new URLSearchParams(params);
  next.delete("cursor");
  next.set("provider", provider);
  next.set("model", model);
  return `/investigations?${next.toString()}#execution-explorer`;
}

export function withoutParam(params: URLSearchParams, key: string): string {
  const next = new URLSearchParams(params);
  next.delete(key);
  next.delete("cursor");
  return `/investigations${next.size ? `?${next.toString()}` : ""}#execution-explorer`;
}

export function activeFilterDescriptions(
  params: URLSearchParams,
): Array<{ key: string; value: string; label: string; href: string }> {
  return filterKeys.flatMap((key) =>
    params.getAll(key).map((value) => ({
      key,
      value,
      label: `${key}: ${value}`,
      href: withoutParam(params, key),
    })),
  );
}

export function toSavedScope(
  range: ResolvedWorkbenchRange,
  params: URLSearchParams,
): SavedInvestigationScope {
  const query = params.get("q")?.trim();
  const statuses = canonicalValues(params, "status") as NonNullable<
    SavedInvestigationScope["statuses"]
  >;
  const providers = canonicalValues(params, "provider");
  const models = canonicalValues(params, "model");
  const errorCode = params.get("errorCode")?.trim();
  return {
    range,
    ...(query ? { query } : {}),
    ...(statuses.length ? { statuses } : {}),
    ...(providers.length ? { providers } : {}),
    ...(models.length ? { models } : {}),
    ...(params.get("errorCategory")
      ? {
          errorCategory: params.get("errorCategory") as NonNullable<
            SavedInvestigationScope["errorCategory"]
          >,
        }
      : {}),
    ...(errorCode ? { errorCode } : {}),
    ...(params.get("signal")
      ? {
          signal: params.get("signal") as NonNullable<SavedInvestigationScope["signal"]>,
        }
      : {}),
  };
}

export function activeProviderEvidence(
  scope: SavedInvestigationScope,
): Extract<InvestigationCaseEvidenceInput, { type: "provider_observation" }> | null {
  if (scope.providers?.length !== 1 || scope.models?.length !== 1) return null;
  return {
    type: "provider_observation",
    provider: scope.providers[0]!,
    model: scope.models[0]!,
    range: scope.range,
  };
}

export function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function all(value: SearchValue): string[] {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function isWindowPreset(value: string | undefined): value is WindowPreset {
  return valuePresets().includes(value as WindowPreset);
}

function valuePresets(): readonly WindowPreset[] {
  return windowPresets;
}

function copyFilters(source: URLSearchParams, target: URLSearchParams, keys: string[]) {
  for (const key of keys) {
    for (const value of source.getAll(key)) {
      if (value.trim()) target.append(key, value);
    }
  }
}

function canonicalValues(params: URLSearchParams, key: string): string[] {
  return [...new Set(params.getAll(key).flatMap((value) => value.split(",")))]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}
