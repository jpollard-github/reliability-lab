import { Type, type Static } from "@sinclair/typebox";
import type { ExecutionId, TenantId } from "../common/identifiers.js";
import type { ExecutionEnvelope } from "../execution/envelope.js";
import type { ExecutionBudget, ExecutionPolicy } from "../execution/policy.js";
import type { FailureMode } from "../execution/status.js";
import { ReplayVariationSchema, type ReplayVariation } from "../replay/replay.js";

/**
 * Comparative Replay experiment and read-projection contracts.
 * These shapes record evidence and tradeoffs; they never declare a universal winner.
 */
export const CreateComparisonBodySchema = Type.Object(
  { variation: ReplayVariationSchema },
  { additionalProperties: false },
);
export type CreateComparisonBody = Static<typeof CreateComparisonBodySchema>;

export const ComparisonExperimentStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("completed"),
  Type.Literal("unavailable"),
]);
export type ComparisonExperimentStatus = Static<typeof ComparisonExperimentStatusSchema>;

export interface ResolvedReplayConfiguration {
  provider: string;
  model: string;
  policy: ExecutionPolicy;
  budget: ExecutionBudget;
  structuredOutputRequired: boolean;
  failureMode?: FailureMode;
}

export interface ComparisonExperiment {
  schemaVersion: 1;
  experimentId: string;
  tenantId: TenantId;
  originalExecutionId: ExecutionId;
  variantExecutionId?: ExecutionId;
  status: ComparisonExperimentStatus;
  requestedVariation: ReplayVariation;
  resolvedVariant: ResolvedReplayConfiguration;
  createdAt: string;
  updatedAt: string;
  unavailableReason?: string;
}

export const ComparisonChangeSchema = Type.Union([
  Type.Literal("improved"),
  Type.Literal("worsened"),
  Type.Literal("unchanged"),
  Type.Literal("mixed"),
  Type.Literal("unavailable"),
]);
export type ComparisonChange = Static<typeof ComparisonChangeSchema>;

export type ComparisonValue = string | number | boolean | null;

export interface ComparisonDimension {
  key: string;
  label: string;
  original: ComparisonValue;
  variant: ComparisonValue;
  change: ComparisonChange;
  explanation: string;
}

export interface ComparisonProjection {
  schemaVersion: 1;
  summary: string;
  dimensions: ComparisonDimension[];
}

export interface ComparisonView {
  experiment: ComparisonExperiment;
  originalExecution: ExecutionEnvelope;
  variantExecution?: ExecutionEnvelope;
  projection: ComparisonProjection;
}
