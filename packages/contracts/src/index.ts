import { Type, type Static } from "@sinclair/typebox";

export type ExecutionId = string;
export type TenantId = string;

export const ExecutionStatusSchema = Type.Union([
  Type.Literal("queued"),
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("degraded"),
  Type.Literal("failed"),
  Type.Literal("cancelled"),
]);
export type ExecutionStatus = Static<typeof ExecutionStatusSchema>;

export const ExecutionJobStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("leased"),
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("ambiguous"),
]);
export type ExecutionJobStatus = Static<typeof ExecutionJobStatusSchema>;

export const ReplayCapabilityStateSchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("retention_disabled"),
  Type.Literal("expired"),
  Type.Literal("deleted"),
  Type.Literal("missing"),
  Type.Literal("key_unavailable"),
  Type.Literal("unreadable"),
]);
export type ReplayCapabilityState = Static<typeof ReplayCapabilityStateSchema>;

export interface ReplayCapability {
  state: ReplayCapabilityState;
  available: boolean;
  reason: string;
  expiresAt?: string;
  deletedAt?: string;
}

export const AttemptStatusSchema = Type.Union([
  Type.Literal("running"),
  Type.Literal("succeeded"),
  Type.Literal("failed"),
  Type.Literal("timed_out"),
  Type.Literal("rejected"),
]);
export type AttemptStatus = Static<typeof AttemptStatusSchema>;

export const FailureModeSchema = Type.Union([
  Type.Literal("latency"),
  Type.Literal("timeout"),
  Type.Literal("rate_limit"),
  Type.Literal("malformed_json"),
  Type.Literal("provider_error"),
]);
export type FailureMode = Static<typeof FailureModeSchema>;

export const ProviderErrorCategorySchema = Type.Union([
  Type.Literal("timeout"),
  Type.Literal("rate_limit"),
  Type.Literal("authentication"),
  Type.Literal("invalid_request"),
  Type.Literal("provider_unavailable"),
  Type.Literal("malformed_response"),
  Type.Literal("budget_exceeded"),
  Type.Literal("unknown"),
]);
export type ProviderErrorCategory = Static<typeof ProviderErrorCategorySchema>;

export interface ProviderError {
  category: ProviderErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  httpStatus?: number;
}

export const MessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("system"), Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String({ minLength: 1, maxLength: 100_000 }),
  },
  { additionalProperties: false },
);
export type Message = Static<typeof MessageSchema>;

export interface ProviderRequest {
  executionId: ExecutionId;
  tenantId: TenantId;
  provider: string;
  model: string;
  messages?: Message[];
  input?: string;
  structuredOutputSchema?: Record<string, unknown>;
  failureMode?: FailureMode;
  attempt: number;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}

export interface StructuredOutputValidation {
  valid: boolean;
  errors?: string[];
}

export interface ProviderResponse {
  provider: string;
  model: string;
  outputText: string;
  outputJson?: unknown;
  usage: ProviderUsage;
  latencyMs: number;
  validation?: StructuredOutputValidation;
}

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

interface EventBase {
  schemaVersion: 1;
  eventId: string;
  executionId: ExecutionId;
  sequence: number;
  occurredAt: string;
}

export type ExecutionEvent =
  | (EventBase & { type: "execution.accepted"; tenantId: TenantId; requestHash: string })
  | (EventBase & { type: "execution.queued" })
  | (EventBase & { type: "worker.claimed" })
  | (EventBase & { type: "execution.recovery_detected"; reason: string })
  | (EventBase & {
      type: "attempt.outcome_ambiguous";
      attemptNumber: number;
      provider: string;
      model: string;
    })
  | (EventBase & { type: "idempotency.hit"; idempotencyKeyHash: string })
  | (EventBase & {
      type: "attempt.started";
      attemptNumber: number;
      provider: string;
      model: string;
    })
  | (EventBase & {
      type: "provider.response_received";
      attemptNumber: number;
      provider: string;
      model: string;
      latencyMs: number;
    })
  | (EventBase & {
      type: "attempt.failed";
      attemptNumber: number;
      provider: string;
      model: string;
      latencyMs: number;
      error: ProviderError;
    })
  | (EventBase & {
      type: "retry.scheduled";
      attemptNumber: number;
      delayMs: number;
      reason: string;
    })
  | (EventBase & { type: "structured_output.rejected"; attemptNumber: number; errors: string[] })
  | (EventBase & { type: "structured_output.validated"; attemptNumber: number })
  | (EventBase & { type: "fallback.selected"; provider: string; model: string; reason: string })
  | (EventBase & {
      type: "budget.exceeded";
      budget: "latency" | "cost";
      limit: number;
      observed: number;
    })
  | (EventBase & { type: "circuit.opened"; provider: string })
  | (EventBase & { type: "circuit.rejected"; provider: string })
  | (EventBase & { type: "execution.succeeded"; status: "succeeded" | "degraded" })
  | (EventBase & { type: "execution.failed"; error: ProviderError })
  | (EventBase & { type: "replay.started"; originalExecutionId: ExecutionId })
  | (EventBase & {
      type: "replay.completed";
      originalExecutionId: ExecutionId;
      replayExecutionId: ExecutionId;
      outcomeMatches: boolean | null;
    });

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

export interface ReplayRequest {
  executionId: ExecutionId;
  tenantId: TenantId;
}

export type ReplayResult =
  | {
      replayable: true;
      originalExecutionId: ExecutionId;
      replayExecution: ExecutionEnvelope;
      outcomeMatches: boolean | null;
    }
  | {
      replayable: false;
      originalExecutionId: ExecutionId;
      reason: string;
      capability: ReplayCapability;
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
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    policy: Type.Optional(ReplayVariationPolicySchema),
    budget: Type.Optional(ReplayVariationBudgetSchema),
    reproducibilityCheck: Type.Optional(Type.Boolean({ default: false })),
  },
  { additionalProperties: false },
);
export type ReplayVariation = Static<typeof ReplayVariationSchema>;

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
