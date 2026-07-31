import type {
  CreateExecutionBody,
  ExecutionBudget,
  ExecutionPolicy,
  ProviderCapability,
  ProviderError,
} from "@reliability-lab/contracts";

const MAX_LIVE_INPUT_CHARACTERS = 4_000;
const MAX_LIVE_MESSAGES = 8;
const MAX_LIVE_SCHEMA_BYTES = 16_000;
const MAX_LIVE_LATENCY_MS = 30_000;
const MAX_LIVE_COST_BUDGET_USD = 1;

/**
 * Keeps live execution inputs bounded and tied to server-owned provider configuration.
 * Deterministic fixtures retain their broader laboratory controls.
 */
export function validateLiveProviderRequest(input: {
  body: CreateExecutionBody;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  capability: ProviderCapability;
}): ProviderError | null {
  const { body, policy, budget, capability } = input;
  if (capability.kind !== "live") return null;
  if (
    !capability.configured ||
    !capability.operatorEligible ||
    body.model !== capability.modelLabel
  ) {
    return disallowed("live_provider_configuration_mismatch");
  }
  if (body.failureMode !== undefined) return disallowed("live_failure_injection_not_allowed");
  if ((body.input === undefined) === (body.messages === undefined)) {
    return disallowed("live_input_shape_not_allowed");
  }
  const contentCharacters =
    body.input?.length ??
    body.messages?.reduce((total, message) => total + message.content.length, 0) ??
    0;
  if (
    contentCharacters > MAX_LIVE_INPUT_CHARACTERS ||
    (body.messages?.length ?? 0) > MAX_LIVE_MESSAGES
  ) {
    return disallowed("live_input_too_large");
  }
  if (
    body.structuredOutputSchema &&
    JSON.stringify(body.structuredOutputSchema).length > MAX_LIVE_SCHEMA_BYTES
  ) {
    return disallowed("live_schema_too_large");
  }
  if (policy.maxAttempts > 2 || policy.baseBackoffMs > 5_000 || policy.maxBackoffMs > 5_000) {
    return disallowed("live_policy_out_of_bounds");
  }
  if (
    budget.maxLatencyMs > MAX_LIVE_LATENCY_MS ||
    (budget.maxCostUsd !== undefined && budget.maxCostUsd > MAX_LIVE_COST_BUDGET_USD)
  ) {
    return disallowed("live_budget_out_of_bounds");
  }
  return null;
}

function disallowed(code: string): ProviderError {
  return {
    category: "invalid_request",
    code,
    message: "The live provider request is outside the allowed operator bounds",
    retryable: false,
  };
}
