/**
 * Comparison HTTP schemas retain explicit transport links. ComparisonView remains Type.Unsafe
 * because its projection has no complete runtime contract schema.
 */
import { Type } from "@sinclair/typebox";
import type { ComparisonView } from "@reliability-lab/contracts";
import { ExecutionEnvelopeSchema } from "./executions.js";

export const ComparisonParamsSchema = Type.Object({
  experimentId: Type.String({ minLength: 1 }),
});

const ComparisonExperimentSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    experimentId: Type.String(),
    tenantId: Type.String(),
    originalExecutionId: Type.String(),
    variantExecutionId: Type.Optional(Type.String()),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("unavailable"),
    ]),
    requestedVariation: Type.Object({}, { additionalProperties: true }),
    resolvedVariant: Type.Object({}, { additionalProperties: true }),
    createdAt: Type.String(),
    updatedAt: Type.String(),
    unavailableReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export const ComparisonSubmissionResponseSchema = Type.Object({
  experiment: ComparisonExperimentSchema,
  links: Type.Object({
    self: Type.String(),
    originalExecution: Type.String(),
    variantExecution: Type.Optional(Type.String()),
  }),
});

export const ComparisonViewSchema = Type.Unsafe<ComparisonView>({
  type: "object",
  required: ["experiment", "originalExecution", "projection"],
  additionalProperties: false,
  properties: {
    experiment: ComparisonExperimentSchema,
    originalExecution: ExecutionEnvelopeSchema,
    variantExecution: ExecutionEnvelopeSchema,
    projection: { type: "object", additionalProperties: true },
  },
});
