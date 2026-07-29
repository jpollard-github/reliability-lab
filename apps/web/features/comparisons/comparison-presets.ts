import type { ExecutionEnvelope } from "@reliability-lab/contracts";
import { emptyComparisonDraft, type ComparisonDraft } from "./comparison-draft";

export const comparisonPresets = [
  { value: "same", label: "Same conditions" },
  { value: "fewer", label: "Fewer retries" },
  { value: "fallback", label: "Immediate fallback" },
  { value: "tighter", label: "Tighter budget" },
  { value: "patient", label: "More patient retry" },
] as const;

export type ComparisonPreset = (typeof comparisonPresets)[number]["value"];

export function applyComparisonPreset(
  preset: ComparisonPreset,
  execution: ExecutionEnvelope,
): ComparisonDraft {
  const inherited = execution.policy;
  switch (preset) {
    case "same":
      return { ...emptyComparisonDraft, reproducibilityCheck: true };
    case "fewer":
      return {
        ...emptyComparisonDraft,
        maxAttempts: String(Math.max(1, inherited.maxAttempts - 1)),
      };
    case "fallback":
      return {
        ...emptyComparisonDraft,
        maxAttempts: "1",
        fallbackProvider: "fake-fallback",
        fallbackModel: "deterministic-v1",
      };
    case "tighter":
      return {
        ...emptyComparisonDraft,
        maxLatencyMs: String(Math.max(1, Math.floor(execution.budget.maxLatencyMs / 2))),
      };
    case "patient":
      return {
        ...emptyComparisonDraft,
        maxAttempts: String(Math.min(5, inherited.maxAttempts + 1)),
        baseBackoffMs: String(Math.min(30_000, Math.max(100, inherited.baseBackoffMs * 2))),
        maxBackoffMs: String(
          Math.min(60_000, Math.max(inherited.maxBackoffMs, inherited.baseBackoffMs * 4)),
        ),
      };
  }
}
