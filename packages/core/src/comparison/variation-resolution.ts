import type {
  ExecutionBudget,
  ExecutionEnvelope,
  ExecutionPolicy,
  FailureMode,
  ReplayVariation,
  ResolvedReplayConfiguration,
} from "@reliability-lab/contracts";
import { InvalidComparisonVariationError } from "./errors.js";

/**
 * Resolves and validates controlled replay variations against safe original evidence.
 * It does not read replay capsules, submit executions, or project comparison outcomes.
 */
export function resolveReplayVariation(input: {
  original: ExecutionEnvelope;
  variation: ReplayVariation;
  structuredOutputRequired: boolean;
  failureMode?: FailureMode;
  providerAvailable: (provider: string) => boolean;
}): ResolvedReplayConfiguration {
  const { original, variation } = input;
  const originalProvider = original.attempts[0]?.provider ?? original.provider;
  const originalModel = original.attempts[0]?.model ?? original.model;
  const provider = clean(variation.provider ?? originalProvider, "provider");
  const model = clean(variation.model ?? originalModel, "model");
  if (!input.providerAvailable(provider)) {
    throw new InvalidComparisonVariationError(`Provider '${provider}' is not configured`);
  }

  const requestedPolicy = variation.policy ?? {};
  const policy: ExecutionPolicy = {
    ...original.policy,
    ...(requestedPolicy.maxAttempts === undefined
      ? {}
      : { maxAttempts: requestedPolicy.maxAttempts }),
    ...(requestedPolicy.baseBackoffMs === undefined
      ? {}
      : { baseBackoffMs: requestedPolicy.baseBackoffMs }),
    ...(requestedPolicy.maxBackoffMs === undefined
      ? {}
      : { maxBackoffMs: requestedPolicy.maxBackoffMs }),
    ...(requestedPolicy.jitterRatio === undefined
      ? {}
      : { jitterRatio: requestedPolicy.jitterRatio }),
  };
  validatePolicy(policy);

  if (requestedPolicy.fallbackProvider === null) {
    if (requestedPolicy.fallbackModel !== undefined && requestedPolicy.fallbackModel !== null) {
      throw new InvalidComparisonVariationError(
        "A fallback model cannot be set while removing the fallback provider",
      );
    }
    delete policy.fallbackProvider;
    delete policy.fallbackModel;
  } else {
    const fallbackProvider =
      requestedPolicy.fallbackProvider === undefined
        ? policy.fallbackProvider
        : clean(requestedPolicy.fallbackProvider, "fallback provider");
    if (fallbackProvider) {
      if (!input.providerAvailable(fallbackProvider)) {
        throw new InvalidComparisonVariationError(
          `Fallback provider '${fallbackProvider}' is not configured`,
        );
      }
      policy.fallbackProvider = fallbackProvider;
      if (requestedPolicy.fallbackModel === null) {
        policy.fallbackModel = model;
      } else {
        policy.fallbackModel = clean(
          requestedPolicy.fallbackModel ?? policy.fallbackModel ?? model,
          "fallback model",
        );
      }
    } else if (requestedPolicy.fallbackModel !== undefined) {
      throw new InvalidComparisonVariationError(
        "A fallback model cannot be set without a fallback provider",
      );
    }
  }

  const budget: ExecutionBudget = {
    ...original.budget,
    ...(variation.budget?.maxLatencyMs === undefined
      ? {}
      : { maxLatencyMs: variation.budget.maxLatencyMs }),
  };
  if (variation.budget?.maxCostUsd === null) {
    delete budget.maxCostUsd;
  } else if (variation.budget?.maxCostUsd !== undefined) {
    budget.maxCostUsd = variation.budget.maxCostUsd;
  }
  validateBudget(budget);

  const resolved: ResolvedReplayConfiguration = {
    provider,
    model,
    policy,
    budget,
    structuredOutputRequired: input.structuredOutputRequired,
    ...(input.failureMode ? { failureMode: input.failureMode } : {}),
  };
  const originalConfiguration: ResolvedReplayConfiguration = {
    provider: originalProvider,
    model: originalModel,
    policy: original.policy,
    budget: original.budget,
    structuredOutputRequired: input.structuredOutputRequired,
    ...(input.failureMode ? { failureMode: input.failureMode } : {}),
  };
  if (
    canonical(resolved) === canonical(originalConfiguration) &&
    variation.reproducibilityCheck !== true
  ) {
    throw new InvalidComparisonVariationError(
      "The variation does not change execution conditions; choose a variant or explicitly request a reproducibility check",
    );
  }
  return resolved;
}

export function inferSafeOriginalConfiguration(
  original: ExecutionEnvelope,
): ResolvedReplayConfiguration {
  return {
    provider: original.attempts[0]?.provider ?? original.provider,
    model: original.attempts[0]?.model ?? original.model,
    policy: structuredClone(original.policy),
    budget: structuredClone(original.budget),
    structuredOutputRequired: original.attempts.some((attempt) => attempt.validation !== undefined),
  };
}
function validatePolicy(policy: ExecutionPolicy): void {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 5) {
    throw new InvalidComparisonVariationError("maxAttempts must be an integer from 1 through 5");
  }
  if (
    !Number.isInteger(policy.baseBackoffMs) ||
    policy.baseBackoffMs < 0 ||
    policy.baseBackoffMs > 30_000
  ) {
    throw new InvalidComparisonVariationError("baseBackoffMs must be from 0 through 30000");
  }
  if (
    !Number.isInteger(policy.maxBackoffMs) ||
    policy.maxBackoffMs < 0 ||
    policy.maxBackoffMs > 60_000
  ) {
    throw new InvalidComparisonVariationError("maxBackoffMs must be from 0 through 60000");
  }
  if (policy.maxBackoffMs < policy.baseBackoffMs) {
    throw new InvalidComparisonVariationError("maxBackoffMs cannot be lower than baseBackoffMs");
  }
  if (policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new InvalidComparisonVariationError("jitterRatio must be from 0 through 1");
  }
}

function validateBudget(budget: ExecutionBudget): void {
  if (
    !Number.isInteger(budget.maxLatencyMs) ||
    budget.maxLatencyMs < 1 ||
    budget.maxLatencyMs > 300_000
  ) {
    throw new InvalidComparisonVariationError("maxLatencyMs must be from 1 through 300000");
  }
  if (budget.maxCostUsd !== undefined && budget.maxCostUsd < 0) {
    throw new InvalidComparisonVariationError("maxCostUsd cannot be negative");
  }
}

function clean(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new InvalidComparisonVariationError(`${label} cannot be empty`);
  return result;
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
