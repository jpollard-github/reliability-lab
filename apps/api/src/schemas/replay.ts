import { Type } from "@sinclair/typebox";
import { ExecutionEnvelopeSchema, ReplayCapabilitySchema } from "./executions.js";

export const ReplayResponseSchema = Type.Union([
  Type.Object({
    replayable: Type.Literal(true),
    originalExecutionId: Type.String(),
    replayExecution: ExecutionEnvelopeSchema,
    outcomeMatches: Type.Union([Type.Boolean(), Type.Null()]),
  }),
  Type.Object({
    replayable: Type.Literal(false),
    originalExecutionId: Type.String(),
    reason: Type.String(),
    capability: ReplayCapabilitySchema,
  }),
]);

export const DeleteReplayResponseSchema = Type.Object({
  executionId: Type.String(),
  deleted: Type.Boolean(),
  replayCapability: ReplayCapabilitySchema,
});
