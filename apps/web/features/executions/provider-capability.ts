import type { ProviderCapability } from "@reliability-lab/contracts";

export function selectOperatorLiveProvider(
  capabilities: ProviderCapability[],
): ProviderCapability | undefined {
  return capabilities.find(
    (provider) => provider.kind === "live" && provider.configured && provider.operatorEligible,
  );
}
