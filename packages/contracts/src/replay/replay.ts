import { Type, type Static } from "@sinclair/typebox";
import type { ExecutionId, TenantId } from "../common/identifiers.js";
import type { ExecutionEnvelope } from "../execution/envelope.js";
import type { ReplayCapability } from "./capability.js";

/**
 * Replay requests, results, and controlled variation contracts.
 * Replay retention and execution orchestration remain outside this package.
 */
export interface ReplayRequest {
  executionId: ExecutionId;
  tenantId: TenantId;
}

export type ReplayResult =
  | {
      replayable: false;
      originalExecutionId: ExecutionId;
      reason: string;
      capability: ReplayCapability;
    }
  | {
      replayable: true;
      originalExecutionId: ExecutionId;
      replayExecution: ExecutionEnvelope;
      outcomeMatches: boolean | null;
    };

export const ReplayVariationPolicySchema = Type.Object(
  {
    maxAttempts: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    baseBackoffMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30_000 })),
    maxBackoffMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 60_000 })),
    jitterRatio: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    fallbackProvider: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    ),
    fallbackModel: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()]),
    ),
  },
  { additionalProperties: false },
);
export type ReplayVariationPolicy = Static<typeof ReplayVariationPolicySchema>;

export const ReplayVariationBudgetSchema = Type.Object(
  {
    maxLatencyMs: Type.Optional(Type.Integer({ minimum: 1, maximum: 300_000 })),
    maxCostUsd: Type.Optional(Type.Union([Type.Number({ minimum: 0 }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type ReplayVariationBudget = Static<typeof ReplayVariationBudgetSchema>;

export const ReplayVariationSchema = Type.Object(
  {
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    policy: Type.Optional(ReplayVariationPolicySchema),
    budget: Type.Optional(ReplayVariationBudgetSchema),
    reproducibilityCheck: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);
export type ReplayVariation = Static<typeof ReplayVariationSchema>;
