/**
 * Comparison HTTP schemas retain explicit transport links. ComparisonView remains Type.Unsafe
 * because its projection has no complete runtime contract schema.
 */
import { Type } from "@sinclair/typebox";
import { ComparisonExperimentSchema, type ComparisonView } from "@reliability-lab/contracts";
import { ExecutionEnvelopeSchema } from "./executions.js";

export const ComparisonParamsSchema = Type.Object({
  experimentId: Type.String({ minLength: 1 }),
});

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
