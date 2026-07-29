import type { ReplayVariation, ReplayVariationPolicy } from "@reliability-lab/contracts";

export interface ComparisonDraft {
  provider: string;
  model: string;
  maxAttempts: string;
  baseBackoffMs: string;
  maxBackoffMs: string;
  jitterRatio: string;
  fallbackProvider: string;
  fallbackModel: string;
  maxLatencyMs: string;
  reproducibilityCheck: boolean;
}

export const emptyComparisonDraft: ComparisonDraft = {
  provider: "",
  model: "",
  maxAttempts: "",
  baseBackoffMs: "",
  maxBackoffMs: "",
  jitterRatio: "",
  fallbackProvider: "",
  fallbackModel: "",
  maxLatencyMs: "",
  reproducibilityCheck: false,
};

export function toReplayVariation(draft: ComparisonDraft): ReplayVariation {
  const policy: ReplayVariationPolicy = {};
  addNumber(policy, "maxAttempts", draft.maxAttempts);
  addNumber(policy, "baseBackoffMs", draft.baseBackoffMs);
  addNumber(policy, "maxBackoffMs", draft.maxBackoffMs);
  addNumber(policy, "jitterRatio", draft.jitterRatio);
  if (draft.fallbackProvider === "_remove") policy.fallbackProvider = null;
  else if (draft.fallbackProvider) policy.fallbackProvider = draft.fallbackProvider;
  if (draft.fallbackModel) policy.fallbackModel = draft.fallbackModel;
  return {
    ...(draft.provider ? { provider: draft.provider } : {}),
    ...(draft.model ? { model: draft.model } : {}),
    ...(Object.keys(policy).length ? { policy } : {}),
    ...(draft.maxLatencyMs ? { budget: { maxLatencyMs: Number(draft.maxLatencyMs) } } : {}),
    ...(draft.reproducibilityCheck ? { reproducibilityCheck: true } : {}),
  };
}

function addNumber(
  target: ReplayVariationPolicy,
  key: "maxAttempts" | "baseBackoffMs" | "maxBackoffMs" | "jitterRatio",
  value: string,
) {
  if (value) target[key] = Number(value);
}
