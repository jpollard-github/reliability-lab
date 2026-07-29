import type { ExecutionId, TenantId } from "../common/identifiers.js";
import type { ReplayCapability } from "../replay/capability.js";
import type { ExecutionEvent } from "./events.js";
import type { ExecutionBudget, ExecutionPolicy } from "./policy.js";
import type { ProviderError } from "./status.js";
import type { AttemptStatus } from "./status.js";
import type { ProviderUsage, StructuredOutputValidation } from "./provider.js";
import type { ExecutionStatus } from "./status.js";

/**
 * The inspectable execution envelope and its recorded attempts.
 * It references events and replay capability but owns neither execution policy nor retention.
 */
export interface ExecutionAttempt {
  attemptNumber: number;
  provider: string;
  model: string;
  status: AttemptStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  usage?: ProviderUsage;
  validation?: StructuredOutputValidation;
  error?: ProviderError;
}

export interface ExecutionEnvelope {
  schemaVersion: 1;
  executionId: ExecutionId;
  tenantId: TenantId;
  status: ExecutionStatus;
  provider: string;
  model: string;
  traceId: string;
  requestHash: string;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  attempts: ExecutionAttempt[];
  events: ExecutionEvent[];
  createdAt: string;
  updatedAt: string;
  durationMs?: number;
  outputText?: string;
  outputJson?: unknown;
  error?: ProviderError;
  replayOfExecutionId?: ExecutionId;
  replayCapability: ReplayCapability;
  /** Compatibility projection of replayCapability.available. */
  replayable: boolean;
  /** Compatibility projection of replayCapability.reason when unavailable. */
  replayUnavailableReason?: string;
}
