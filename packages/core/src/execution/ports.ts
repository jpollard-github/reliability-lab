import type {
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";

/**
 * Persistence required by execution-domain behavior.
 * Implementations may be in memory or PostgreSQL; this port exposes neither technology.
 */
export interface ExecutionRepository {
  create(execution: ExecutionEnvelope): Promise<void>;
  update(execution: ExecutionEnvelope): Promise<void>;
  appendEvent(event: ExecutionEvent): Promise<void>;
  eventsAfter(
    tenantId: TenantId,
    executionId: ExecutionId,
    afterSequence: number,
  ): Promise<ExecutionEvent[] | null>;
  findById(tenantId: TenantId, executionId: ExecutionId): Promise<ExecutionEnvelope | null>;
  list(tenantId?: TenantId): Promise<ExecutionEnvelope[]>;
  findIdempotent(tenantId: TenantId, keyHash: string): Promise<ExecutionEnvelope | null>;
  recordIdempotency(
    tenantId: TenantId,
    keyHash: string,
    requestHash: string,
    executionId: ExecutionId,
  ): Promise<void>;
}
