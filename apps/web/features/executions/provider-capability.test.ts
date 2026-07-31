import { describe, expect, it } from "vitest";
import type { ProviderCapability } from "@reliability-lab/contracts";
import { selectOperatorLiveProvider } from "./provider-capability.js";

const unavailable: ProviderCapability = {
  id: "openai-compatible",
  kind: "live",
  modelLabel: "Not configured",
  transportFamily: "openai_compatible_chat_completions",
  configured: false,
  supportsFailureInjection: false,
  operatorEligible: false,
  unavailableReason: "Live provider is not configured.",
};

describe("selectOperatorLiveProvider", () => {
  it("keeps the live section absent when no eligible provider is configured", () => {
    expect(selectOperatorLiveProvider([unavailable])).toBeUndefined();
  });

  it("returns only an eligible configured live capability", () => {
    const { unavailableReason: _unavailableReason, ...availableFields } = unavailable;
    const eligible = {
      ...availableFields,
      modelLabel: "safe-model",
      configured: true,
      operatorEligible: true,
    } satisfies ProviderCapability;
    expect(selectOperatorLiveProvider([unavailable, eligible])).toEqual(eligible);
  });
});
