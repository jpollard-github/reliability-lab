import { Type, type Static } from "@sinclair/typebox";
import type { ExecutionEnvelope } from "../execution/envelope.js";
import { ExecutionBudgetSchema, ExecutionPolicySchema } from "../execution/policy.js";
import { FailureModeSchema } from "../execution/status.js";
import { ReplayVariationSchema } from "../replay/replay.js";

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

export const ResolvedReplayConfigurationSchema = Type.Object(
  {
    provider: Type.String(),
    model: Type.String(),
    policy: ExecutionPolicySchema,
    budget: ExecutionBudgetSchema,
    structuredOutputRequired: Type.Boolean(),
    failureMode: Type.Optional(FailureModeSchema),
  },
  { additionalProperties: false },
);
export type ResolvedReplayConfiguration = Static<typeof ResolvedReplayConfigurationSchema>;

export const ComparisonExperimentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    experimentId: Type.String(),
    tenantId: Type.String(),
    originalExecutionId: Type.String(),
    variantExecutionId: Type.Optional(Type.String()),
    status: ComparisonExperimentStatusSchema,
    requestedVariation: ReplayVariationSchema,
    resolvedVariant: ResolvedReplayConfigurationSchema,
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    unavailableReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type ComparisonExperiment = Static<typeof ComparisonExperimentSchema>;

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
