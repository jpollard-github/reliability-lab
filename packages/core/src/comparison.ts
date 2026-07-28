import type {
  ComparisonChange,
  ComparisonDimension,
  ComparisonProjection,
  ExecutionBudget,
  ExecutionEnvelope,
  ExecutionPolicy,
  FailureMode,
  ReplayVariation,
  ResolvedReplayConfiguration,
} from "@reliability-lab/contracts";

export class InvalidComparisonVariationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = "InvalidComparisonVariationError";
  }
}

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

export function projectComparison(
  original: ExecutionEnvelope,
  variant?: ExecutionEnvelope,
): ComparisonProjection {
  if (!variant) {
    return {
      schemaVersion: 1,
      summary: "Variant evidence is unavailable, so no outcome comparison can be made.",
      dimensions: unavailableDimensions(original),
    };
  }

  const terminal = isTerminal(original) && isTerminal(variant);
  const dimensions: ComparisonDimension[] = [
    outcomeDimension(original, variant),
    errorDimension(original, variant),
    routeDimension(original, variant),
    numericDimension(
      "attempts",
      "Attempts",
      original.attempts.length,
      variant.attempts.length,
      terminal,
    ),
    numericDimension(
      "retries",
      "Retries",
      countEvent(original, "retry.scheduled"),
      countEvent(variant, "retry.scheduled"),
      terminal,
    ),
    fallbackDimension(original, variant, terminal),
    structuredDimension(original, variant, terminal),
    numericDimension(
      "duration",
      "Duration (ms)",
      original.durationMs,
      variant.durationMs,
      terminal,
    ),
    tokenDimension(
      "input_tokens",
      "Input tokens",
      tokens(original, "inputTokens"),
      tokens(variant, "inputTokens"),
      terminal,
    ),
    tokenDimension(
      "output_tokens",
      "Output tokens",
      tokens(original, "outputTokens"),
      tokens(variant, "outputTokens"),
      terminal,
    ),
    numericDimension("cost", "Estimated cost (USD)", cost(original), cost(variant), terminal),
    latencyBudgetDimension(original, variant, terminal),
    outputMatchDimension(original, variant, terminal),
  ];

  return { schemaVersion: 1, summary: summarize(original, variant, dimensions), dimensions };
}

function outcomeDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
): ComparisonDimension {
  const left = outcome(original);
  const right = outcome(variant);
  if (!isTerminal(original) || !isTerminal(variant)) {
    return dimension(
      "outcome",
      "Outcome",
      left,
      right,
      "unavailable",
      "Both executions must finish.",
    );
  }
  const rank = { failure: 0, degraded: 1, success: 2 } as const;
  const change = compare(rank[left as keyof typeof rank], rank[right as keyof typeof rank]);
  return dimension(
    "outcome",
    "Outcome",
    left,
    right,
    change,
    change === "unchanged"
      ? "Both executions reached the same normalized outcome."
      : "Outcome classification changed; this does not imply a universal winner.",
  );
}

function errorDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
): ComparisonDimension {
  const left = original.error ? `${original.error.category}/${original.error.code}` : "none";
  const right = variant.error ? `${variant.error.category}/${variant.error.code}` : "none";
  if (!isTerminal(original) || !isTerminal(variant)) {
    return dimension(
      "error",
      "Normalized error",
      left,
      right,
      "unavailable",
      "Terminal evidence is incomplete.",
    );
  }
  const change: ComparisonChange =
    left === right
      ? "unchanged"
      : left !== "none" && right === "none"
        ? "improved"
        : left === "none"
          ? "worsened"
          : "mixed";
  return dimension(
    "error",
    "Normalized error",
    left,
    right,
    change,
    "Compares normalized category and code.",
  );
}

function routeDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
): ComparisonDimension {
  const left = route(original);
  const right = route(variant);
  return dimension(
    "route",
    "Provider route",
    left,
    right,
    left === right ? "unchanged" : "mixed",
    left === right
      ? "Provider and model route matched."
      : "The route changed; route choice is a tradeoff, not a score.",
  );
}

function fallbackDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
  terminal: boolean,
): ComparisonDimension {
  const left = countEvent(original, "fallback.selected") > 0;
  const right = countEvent(variant, "fallback.selected") > 0;
  return dimension(
    "fallback",
    "Fallback used",
    left,
    right,
    !terminal ? "unavailable" : left === right ? "unchanged" : "mixed",
    left === right
      ? "Fallback dependence matched."
      : "Fallback dependence changed and should be reviewed as a tradeoff.",
  );
}

function structuredDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
  terminal: boolean,
): ComparisonDimension {
  const left = structured(original);
  const right = structured(variant);
  const change: ComparisonChange = !terminal
    ? "unavailable"
    : left === right
      ? "unchanged"
      : left === "rejected" && right === "validated"
        ? "improved"
        : left === "validated" && right === "rejected"
          ? "worsened"
          : "mixed";
  return dimension(
    "structured_output",
    "Structured output",
    left,
    right,
    change,
    "Uses validator evidence recorded on attempts.",
  );
}

function latencyBudgetDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
  terminal: boolean,
): ComparisonDimension {
  const left = budgetResult(original);
  const right = budgetResult(variant);
  const change: ComparisonChange = !terminal
    ? "unavailable"
    : left === right
      ? "unchanged"
      : left === "exceeded" && right === "within"
        ? "improved"
        : left === "within" && right === "exceeded"
          ? "worsened"
          : "mixed";
  return dimension(
    "latency_budget",
    "Latency budget",
    left,
    right,
    change,
    "Compares recorded latency-budget evidence.",
  );
}

function outputMatchDimension(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
  terminal: boolean,
): ComparisonDimension {
  if (!terminal || original.outputText === undefined || variant.outputText === undefined) {
    return dimension(
      "output_match",
      "Exact output match",
      null,
      null,
      "unavailable",
      "Both successful outputs are required.",
    );
  }
  const match =
    original.outputText === variant.outputText &&
    canonical(original.outputJson) === canonical(variant.outputJson);
  return dimension(
    "output_match",
    "Exact output match",
    true,
    match,
    match ? "unchanged" : "mixed",
    match
      ? "Text and structured outputs match exactly."
      : "Outputs differ exactly; no semantic judgment was applied.",
  );
}

function numericDimension(
  key: string,
  label: string,
  left: number | undefined,
  right: number | undefined,
  terminal: boolean,
): ComparisonDimension {
  if (!terminal || left === undefined || right === undefined) {
    return dimension(
      key,
      label,
      left ?? null,
      right ?? null,
      "unavailable",
      "Complete numeric evidence is unavailable; missing is not zero.",
    );
  }
  return dimension(
    key,
    label,
    left,
    right,
    compare(left, right, true),
    `Lower ${label.toLowerCase()} is treated as improved for this dimension only.`,
  );
}

function tokenDimension(
  key: "input_tokens" | "output_tokens",
  label: string,
  left: number | undefined,
  right: number | undefined,
  terminal: boolean,
): ComparisonDimension {
  if (!terminal || left === undefined || right === undefined) {
    return dimension(
      key,
      label,
      left ?? null,
      right ?? null,
      "unavailable",
      "Complete token evidence is unavailable; missing is not zero.",
    );
  }
  return dimension(
    key,
    label,
    left,
    right,
    left === right ? "unchanged" : "mixed",
    left === right
      ? "Token usage matched."
      : "Token usage changed. Fewer tokens are factual, not inherently better without an evaluated token budget.",
  );
}

function unavailableDimensions(original: ExecutionEnvelope): ComparisonDimension[] {
  const labels = [
    ["outcome", "Outcome"],
    ["error", "Normalized error"],
    ["route", "Provider route"],
    ["attempts", "Attempts"],
    ["retries", "Retries"],
    ["fallback", "Fallback used"],
    ["structured_output", "Structured output"],
    ["duration", "Duration (ms)"],
    ["input_tokens", "Input tokens"],
    ["output_tokens", "Output tokens"],
    ["cost", "Estimated cost (USD)"],
    ["latency_budget", "Latency budget"],
    ["output_match", "Exact output match"],
  ];
  return labels.map(([key, label]) =>
    dimension(
      key!,
      label!,
      key === "outcome" ? outcome(original) : null,
      null,
      "unavailable",
      "Variant evidence is unavailable.",
    ),
  );
}

function summarize(
  original: ExecutionEnvelope,
  variant: ExecutionEnvelope,
  dimensions: ComparisonDimension[],
): string {
  if (!isTerminal(original) || !isTerminal(variant)) {
    return `Comparison is still running: original is ${original.status} and variant is ${variant.status}.`;
  }
  const improved = dimensions.filter((item) => item.change === "improved").length;
  const worsened = dimensions.filter((item) => item.change === "worsened").length;
  const mixed = dimensions.filter((item) => item.change === "mixed").length;
  if (improved === 0 && worsened === 0 && mixed === 0) {
    return "Recorded conditions produced unchanged normalized evidence across the compared dimensions.";
  }
  return `${improved} dimension${improved === 1 ? "" : "s"} improved, ${worsened} worsened, and ${mixed} changed with mixed meaning. Review each dimension; no universal winner is assigned.`;
}

function dimension(
  key: string,
  label: string,
  original: string | number | boolean | null,
  variant: string | number | boolean | null,
  change: ComparisonChange,
  explanation: string,
): ComparisonDimension {
  return { key, label, original, variant, change, explanation };
}

function compare(original: number, variant: number, lowerIsBetter = false): ComparisonChange {
  if (variant === original) return "unchanged";
  return (lowerIsBetter ? variant < original : variant > original) ? "improved" : "worsened";
}

function outcome(execution: ExecutionEnvelope): string {
  if (!isTerminal(execution)) return "running";
  if (execution.status === "succeeded") return "success";
  if (execution.status === "degraded") return "degraded";
  return "failure";
}

function isTerminal(execution: ExecutionEnvelope): boolean {
  return ["succeeded", "degraded", "failed", "cancelled"].includes(execution.status);
}

function countEvent(execution: ExecutionEnvelope, type: string): number {
  return execution.events.filter((event) => event.type === type).length;
}

function route(execution: ExecutionEnvelope): string {
  const route = execution.attempts.map((attempt) => `${attempt.provider}/${attempt.model}`);
  return [...new Set(route)].join(" → ") || `${execution.provider}/${execution.model}`;
}

function structured(execution: ExecutionEnvelope): string {
  if (execution.attempts.some((attempt) => attempt.validation?.valid === false)) return "rejected";
  if (execution.attempts.some((attempt) => attempt.validation?.valid === true)) return "validated";
  return "not requested";
}

function budgetResult(execution: ExecutionEnvelope): string {
  return execution.events.some(
    (event) => event.type === "budget.exceeded" && event.budget === "latency",
  )
    ? "exceeded"
    : isTerminal(execution)
      ? "within"
      : "pending";
}

function tokens(
  execution: ExecutionEnvelope,
  key: "inputTokens" | "outputTokens",
): number | undefined {
  if (execution.attempts.length === 0 || execution.attempts.some((attempt) => !attempt.usage)) {
    return undefined;
  }
  return execution.attempts.reduce((total, attempt) => total + (attempt.usage?.[key] ?? 0), 0);
}

function cost(execution: ExecutionEnvelope): number | undefined {
  if (
    execution.attempts.length === 0 ||
    execution.attempts.some((attempt) => attempt.usage?.estimatedCostUsd === undefined)
  ) {
    return undefined;
  }
  return execution.attempts.reduce(
    (total, attempt) => total + (attempt.usage?.estimatedCostUsd ?? 0),
    0,
  );
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
