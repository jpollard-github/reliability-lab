import type {
  ExecutionId,
  ProviderRequest,
  ReplayCapability,
  TenantId,
} from "@reliability-lab/contracts";

/**
 * Replay retention port and capability helpers.
 * Replay capsules are distinct from transient durable execution commands.
 */
export interface ReplayCapsule {
  providerRequest: Omit<ProviderRequest, "executionId" | "attempt">;
}

export interface StoreReplayCapsule {
  tenantId: TenantId;
  executionId: ExecutionId;
  capsule: ReplayCapsule;
  payloadSchemaVersion: 1;
  expiresAt: string;
}

export type ReplayCapsuleReadResult =
  | { available: true; capability: ReplayCapability; capsule: ReplayCapsule }
  | { available: false; capability: ReplayCapability };

export interface ReplayCapsuleDeleteResult {
  deleted: boolean;
  capability: ReplayCapability;
}

export interface ReplayCapsuleStore {
  put(input: StoreReplayCapsule): Promise<ReplayCapability>;
  inspect(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapability>;
  getForReplay(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleReadResult>;
  delete(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleDeleteResult>;
}

export function availableCapability(expiresAt: string): ReplayCapability {
  return {
    state: "available",
    available: true,
    reason: "Replay capsule is available",
    expiresAt,
  };
}

export function unavailableCapability(
  state: Exclude<ReplayCapability["state"], "available" | "deleted">,
  reason: string,
): ReplayCapability {
  return { state, available: false, reason };
}

export function deletedCapability(deletedAt: string, expiresAt?: string): ReplayCapability {
  return {
    state: "deleted",
    available: false,
    reason: "Replay capsule was deleted",
    deletedAt,
    ...(expiresAt ? { expiresAt } : {}),
  };
}
