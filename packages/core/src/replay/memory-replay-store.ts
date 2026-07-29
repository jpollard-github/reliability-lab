import type { ExecutionId, ReplayCapability, TenantId } from "@reliability-lab/contracts";
import {
  availableCapability,
  deletedCapability,
  unavailableCapability,
  type ReplayCapsuleDeleteResult,
  type ReplayCapsule,
  type ReplayCapsuleReadResult,
  type ReplayCapsuleStore,
  type StoreReplayCapsule,
} from "./replay-store.js";

/**
 * Process-local replay retention used by tests and in-process mode.
 * It models capability expiry/deletion but does not provide durable encryption.
 */
export class MemoryReplayCapsuleStore implements ReplayCapsuleStore {
  readonly #capsules = new Map<
    string,
    {
      capsule: ReplayCapsule;
      expiresAt: string;
      deletedAt?: string;
    }
  >();
  readonly #audits: Array<{
    tenantId: TenantId;
    executionId: ExecutionId;
    operation: "store" | "inspect" | "read_for_replay" | "delete";
    outcome: string;
    occurredAt: string;
  }> = [];
  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async put(input: StoreReplayCapsule) {
    this.#capsules.set(this.#key(input.tenantId, input.executionId), {
      capsule: structuredClone(input.capsule),
      expiresAt: input.expiresAt,
    });
    this.#audit(input.tenantId, input.executionId, "store", "stored");
    return availableCapability(input.expiresAt);
  }

  async inspect(tenantId: TenantId, executionId: ExecutionId) {
    const capability = this.#capability(tenantId, executionId);
    this.#audit(tenantId, executionId, "inspect", capability.state);
    return capability;
  }

  async getForReplay(
    tenantId: TenantId,
    executionId: ExecutionId,
  ): Promise<ReplayCapsuleReadResult> {
    const capability = this.#capability(tenantId, executionId);
    this.#audit(tenantId, executionId, "read_for_replay", capability.state);
    if (!capability.available) return { available: false, capability };
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) {
      return {
        available: false,
        capability: unavailableCapability("missing", "Replay capsule is unavailable"),
      };
    }
    return { available: true, capability, capsule: structuredClone(row.capsule) };
  }

  async delete(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleDeleteResult> {
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) {
      const capability = unavailableCapability("missing", "Replay capsule is unavailable");
      this.#audit(tenantId, executionId, "delete", "already_absent");
      return { deleted: false, capability };
    }
    if (row.deletedAt) {
      const capability = deletedCapability(row.deletedAt, row.expiresAt);
      this.#audit(tenantId, executionId, "delete", "already_deleted");
      return { deleted: false, capability };
    }
    row.deletedAt = this.#now().toISOString();
    const capability = deletedCapability(row.deletedAt, row.expiresAt);
    this.#audit(tenantId, executionId, "delete", "deleted");
    return { deleted: true, capability };
  }

  audits() {
    return structuredClone(this.#audits);
  }

  #capability(tenantId: TenantId, executionId: ExecutionId): ReplayCapability {
    const row = this.#capsules.get(this.#key(tenantId, executionId));
    if (!row) return unavailableCapability("missing", "Replay capsule is unavailable");
    if (row.deletedAt) return deletedCapability(row.deletedAt, row.expiresAt);
    if (new Date(row.expiresAt).getTime() <= this.#now().getTime()) {
      return {
        ...unavailableCapability("expired", "Replay capsule retention has expired"),
        expiresAt: row.expiresAt,
      };
    }
    return availableCapability(row.expiresAt);
  }

  #audit(
    tenantId: TenantId,
    executionId: ExecutionId,
    operation: "store" | "inspect" | "read_for_replay" | "delete",
    outcome: string,
  ) {
    this.#audits.push({
      tenantId,
      executionId,
      operation,
      outcome,
      occurredAt: this.#now().toISOString(),
    });
  }

  #key(tenantId: TenantId, executionId: ExecutionId) {
    return `${tenantId}\u0000${executionId}`;
  }
}
