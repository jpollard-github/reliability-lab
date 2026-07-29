import { Type, type Static } from "@sinclair/typebox";
import { MessageSchema } from "./provider.js";
import { ExecutionBudgetSchema, ExecutionPolicySchema } from "./policy.js";
import { FailureModeSchema } from "./status.js";

/**
 * Runtime-validated execution creation input.
 * It composes execution contracts without owning execution behavior.
 */
export const CreateExecutionBodySchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, default: "fake-primary" }),
    model: Type.String({ minLength: 1, default: "deterministic-v1" }),
    messages: Type.Optional(Type.Array(MessageSchema, { minItems: 1, maxItems: 100 })),
    input: Type.Optional(Type.String({ minLength: 1, maxLength: 100_000 })),
    structuredOutputSchema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    policy: Type.Optional(Type.Partial(ExecutionPolicySchema)),
    budget: Type.Optional(Type.Partial(ExecutionBudgetSchema)),
    failureMode: Type.Optional(FailureModeSchema),
  },
  { additionalProperties: false },
);
export type CreateExecutionBody = Static<typeof CreateExecutionBodySchema>;
