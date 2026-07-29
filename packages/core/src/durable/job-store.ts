import type { CreateExecutionBody, ExecutionId, TenantId } from "@reliability-lab/contracts";

/**
 * Durable scheduling and fenced-lease persistence port.
 * The job record carries transient command availability, not replay retention.
 */
export interface JobClaim {
  tenantId: TenantId;
  executionId: ExecutionId;
  workerId: string;
  claimVersion: number;
  leaseExpiresAt: string;
}

export interface ClaimedExecutionJob extends JobClaim {
  command?: CreateExecutionBody;
  reclaimed: boolean;
  safeErrorCode?: string;
}

export type LeaseOwnershipOutcome =
  { kind: "owned"; leaseExpiresAt: string } | { kind: "ownership_lost" };

export type FinishJobOutcome = { kind: "finished" } | { kind: "ownership_lost" };

export interface DurableJobStore {
  claimNext(input: {
    workerId: string;
    leaseDurationMs: number;
  }): Promise<ClaimedExecutionJob | null>;
  heartbeat(input: { claim: JobClaim; leaseDurationMs: number }): Promise<LeaseOwnershipOutcome>;
  assertOwned(claim: JobClaim): Promise<LeaseOwnershipOutcome>;
  finish(input: {
    claim: JobClaim;
    status: "completed" | "failed" | "ambiguous";
    safeErrorCode?: string;
  }): Promise<FinishJobOutcome>;
}
