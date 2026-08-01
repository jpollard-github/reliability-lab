import type { LiveReplayRetentionCapability, ProviderCapability } from "@reliability-lab/contracts";

/** Adds deployment-owned replay permission without exposing vault configuration or secrets. */
export function withLiveReplayRetentionCapability(
  capabilities: ProviderCapability[],
  config: {
    storeMode: "memory" | "postgres";
    allowLivePromptRetention: boolean;
    retentionMs: number;
  },
): ProviderCapability[] {
  const available = config.storeMode === "postgres" && config.allowLivePromptRetention;
  const liveReplayRetention: LiveReplayRetentionCapability = {
    available,
    modeLabel: "Encrypted replay retention",
    retentionHours: config.retentionMs / (60 * 60 * 1_000),
    perExecutionOptInRequired: true,
    ...(!available
      ? {
          unavailableReason:
            config.storeMode !== "postgres"
              ? ("encrypted_vault_not_configured" as const)
              : ("deployment_not_permitted" as const),
        }
      : {}),
  };
  return capabilities.map((capability) =>
    capability.kind === "live" ? { ...capability, liveReplayRetention } : capability,
  );
}
