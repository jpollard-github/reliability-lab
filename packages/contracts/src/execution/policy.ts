import { Type, type Static } from "@sinclair/typebox";

/**
 * Retry, fallback, and budget configuration carried with an execution.
 * Policy evaluation belongs to core; these are only portable shapes and schemas.
 */
export const ExecutionBudgetSchema = Type.Object(
  {
    maxLatencyMs: Type.Integer({ minimum: 1, default: 10_000 }),
    maxCostUsd: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type ExecutionBudget = Static<typeof ExecutionBudgetSchema>;

export const ExecutionPolicySchema = Type.Object(
  {
    maxAttempts: Type.Integer({ minimum: 1, maximum: 5, default: 2 }),
    baseBackoffMs: Type.Integer({ minimum: 0, maximum: 30_000, default: 50 }),
    maxBackoffMs: Type.Integer({ minimum: 0, maximum: 60_000, default: 1_000 }),
    jitterRatio: Type.Number({ minimum: 0, maximum: 1, default: 0.2 }),
    fallbackProvider: Type.Optional(Type.String({ minLength: 1 })),
    fallbackModel: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);
export type ExecutionPolicy = Static<typeof ExecutionPolicySchema>;
