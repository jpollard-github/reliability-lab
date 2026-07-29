import type {
  ComparisonExperiment,
  CreateExecutionBody,
  ExecutionEnvelope,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";

/**
 * Commands and acceptance results crossing the execution composition boundary.
 * Durable command encryption and job claims belong to persistence and durable modules.
 */
export interface ExecuteCommand {
  tenantId: TenantId;
  idempotencyKey?: string;
  body: CreateExecutionBody;
  replayOfExecutionId?: ExecutionId;
}

export interface ExecutionSubmission {
  execution: ExecutionEnvelope;
  completion?: Promise<ExecutionEnvelope>;
}

export interface ComparisonSubmission {
  experiment: ComparisonExperiment;
  variantExecution?: ExecutionEnvelope;
  completion?: Promise<ExecutionEnvelope>;
}

export interface DurableAcceptanceInput {
  execution: ExecutionEnvelope;
  command: CreateExecutionBody;
  requestHash: string;
  idempotencyKeyHash?: string;
}

export interface DurableComparisonAcceptanceInput extends DurableAcceptanceInput {
  experiment: ComparisonExperiment;
}

export interface DurableAcceptancePort {
  acceptExecution(input: DurableAcceptanceInput): Promise<ExecutionId>;
  acceptComparison(input: DurableComparisonAcceptanceInput): Promise<ExecutionId>;
}
