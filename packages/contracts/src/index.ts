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

export const InvestigationSignalSchema = Type.Union([
  Type.Literal("retry_recovered"),
  Type.Literal("fallback_used"),
  Type.Literal("latency_budget_exceeded"),
  Type.Literal("structured_output_rejected"),
  Type.Literal("provider_outcome_ambiguous"),
  Type.Literal("replay_derived"),
]);
export type InvestigationSignal = Static<typeof InvestigationSignalSchema>;

export const InvestigationRangeSchema = Type.Object(
  {
    from: Type.String({ format: "date-time" }),
    to: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type InvestigationRange = Static<typeof InvestigationRangeSchema>;

export const ExecutionSummarySchema = Type.Object(
  {
    executionId: Type.String(),
    status: ExecutionStatusSchema,
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    durationMs: Type.Optional(Type.Integer({ minimum: 0 })),
    initialProvider: Type.String(),
    initialModel: Type.String(),
    finalProvider: Type.Optional(Type.String()),
    finalModel: Type.Optional(Type.String()),
    traceId: Type.String(),
    attemptCount: Type.Integer({ minimum: 0 }),
    retryCount: Type.Integer({ minimum: 0 }),
    signals: Type.Array(InvestigationSignalSchema),
    retryRecovered: Type.Boolean(),
    fallbackUsed: Type.Boolean(),
    latencyBudgetExceeded: Type.Boolean(),
    structuredOutputRejected: Type.Boolean(),
    providerOutcomeAmbiguous: Type.Boolean(),
    errorCategory: Type.Optional(ProviderErrorCategorySchema),
    errorCode: Type.Optional(Type.String()),
    replayOfExecutionId: Type.Optional(Type.String()),
    comparisonCount: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: false },
);
export type ExecutionSummary = Static<typeof ExecutionSummarySchema>;

export const ExecutionSummaryPageSchema = Type.Object(
  {
    range: InvestigationRangeSchema,
    data: Type.Array(ExecutionSummarySchema),
    total: Type.Integer({ minimum: 0 }),
    nextCursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type ExecutionSummaryPage = Static<typeof ExecutionSummaryPageSchema>;

const NullableRateSchema = Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]);

export const ReliabilityTrendBucketSchema = Type.Object(
  {
    from: Type.String({ format: "date-time" }),
    to: Type.String({ format: "date-time" }),
    total: Type.Integer({ minimum: 0 }),
    terminal: Type.Integer({ minimum: 0 }),
    succeeded: Type.Integer({ minimum: 0 }),
    degraded: Type.Integer({ minimum: 0 }),
    failed: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type ReliabilityTrendBucket = Static<typeof ReliabilityTrendBucketSchema>;

export const ReliabilitySummarySchema = Type.Object(
  {
    range: InvestigationRangeSchema,
    population: Type.Object(
      {
        total: Type.Integer({ minimum: 0 }),
        terminal: Type.Integer({ minimum: 0 }),
        inFlight: Type.Integer({ minimum: 0 }),
        queued: Type.Integer({ minimum: 0 }),
        running: Type.Integer({ minimum: 0 }),
        cancelled: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    outcomes: Type.Object(
      {
        succeeded: Type.Integer({ minimum: 0 }),
        degraded: Type.Integer({ minimum: 0 }),
        failed: Type.Integer({ minimum: 0 }),
        successRate: NullableRateSchema,
        degradedRate: NullableRateSchema,
        failureRate: NullableRateSchema,
      },
      { additionalProperties: false },
    ),
    signals: Type.Object(
      {
        retryRecovered: Type.Integer({ minimum: 0 }),
        fallbackUsed: Type.Integer({ minimum: 0 }),
        latencyBudgetExceeded: Type.Integer({ minimum: 0 }),
        structuredOutputRejected: Type.Integer({ minimum: 0 }),
        providerOutcomeAmbiguous: Type.Integer({ minimum: 0 }),
        rateLimitFailures: Type.Integer({ minimum: 0 }),
        timeoutFailures: Type.Integer({ minimum: 0 }),
        providerUnavailableFailures: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    latency: Type.Object(
      {
        sampleSize: Type.Integer({ minimum: 0 }),
        p50Ms: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
        p95Ms: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
    usage: Type.Object(
      {
        executionCoverage: Type.Integer({ minimum: 0 }),
        costCoverage: Type.Integer({ minimum: 0 }),
        inputTokens: Type.Integer({ minimum: 0 }),
        outputTokens: Type.Integer({ minimum: 0 }),
        estimatedCostUsd: Type.Number({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    comparisons: Type.Object(
      {
        completed: Type.Integer({ minimum: 0 }),
        reproducibilityChecks: Type.Integer({ minimum: 0 }),
        exactOutputMatches: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
    trend: Type.Array(ReliabilityTrendBucketSchema),
  },
  { additionalProperties: false },
);
export type ReliabilitySummary = Static<typeof ReliabilitySummarySchema>;

export const ProviderSampleAssessmentSchema = Type.Union([
  Type.Literal("no_evidence"),
  Type.Literal("insufficient_sample"),
  Type.Literal("observed"),
]);
export type ProviderSampleAssessment = Static<typeof ProviderSampleAssessmentSchema>;

export const ProviderObservationSchema = Type.Object(
  {
    provider: Type.String(),
    model: Type.String(),
    attemptCount: Type.Integer({ minimum: 0 }),
    executionCount: Type.Integer({ minimum: 0 }),
    terminalAttemptCount: Type.Integer({ minimum: 0 }),
    succeededAttempts: Type.Integer({ minimum: 0 }),
    failedAttempts: Type.Integer({ minimum: 0 }),
    timedOutAttempts: Type.Integer({ minimum: 0 }),
    rejectedAttempts: Type.Integer({ minimum: 0 }),
    runningAttempts: Type.Integer({ minimum: 0 }),
    observedSuccessRate: NullableRateSchema,
    latencySampleSize: Type.Integer({ minimum: 0 }),
    p50LatencyMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    p95LatencyMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
    rateLimitedAttempts: Type.Integer({ minimum: 0 }),
    providerUnavailableAttempts: Type.Integer({ minimum: 0 }),
    providerErrors: Type.Integer({ minimum: 0 }),
    structuredOutputRejections: Type.Integer({ minimum: 0 }),
    fallbackSelectedToRoute: Type.Integer({ minimum: 0 }),
    sampleAssessment: ProviderSampleAssessmentSchema,
  },
  { additionalProperties: false },
);
export type ProviderObservation = Static<typeof ProviderObservationSchema>;

export const ProviderObservationPageSchema = Type.Object(
  {
    range: InvestigationRangeSchema,
    data: Type.Array(ProviderObservationSchema),
  },
  { additionalProperties: false },
);
export type ProviderObservationPage = Static<typeof ProviderObservationPageSchema>;

export interface InvestigationExecutionQuery {
  range: InvestigationRange;
  limit: number;
  cursor?: string;
  query?: string;
  statuses?: ExecutionStatus[];
  providers?: string[];
  models?: string[];
  errorCategory?: ProviderErrorCategory;
  errorCode?: string;
  signal?: InvestigationSignal;
}

export interface InvestigationProviderQuery {
  range: InvestigationRange;
  limit: number;
  providers?: string[];
  models?: string[];
}

export const InvestigationCaseStatusSchema = Type.Union([
  Type.Literal("open"),
  Type.Literal("investigating"),
  Type.Literal("resolved"),
  Type.Literal("archived"),
]);
export type InvestigationCaseStatus = Static<typeof InvestigationCaseStatusSchema>;

export const InvestigationCaseImportanceSchema = Type.Union([
  Type.Literal("routine"),
  Type.Literal("notable"),
  Type.Literal("urgent"),
]);
export type InvestigationCaseImportance = Static<typeof InvestigationCaseImportanceSchema>;

const PlainTitleSchema = Type.String({
  minLength: 1,
  maxLength: 200,
  pattern: "^(?![\\s\\S]*<\\/?[A-Za-z][^>]*>)[\\s\\S]*$",
});
const PlainQuestionSchema = Type.String({
  minLength: 1,
  maxLength: 2_000,
  pattern: "^(?![\\s\\S]*<\\/?[A-Za-z][^>]*>)[\\s\\S]*$",
});
const PlainFindingSchema = Type.String({
  maxLength: 10_000,
  pattern: "^(?![\\s\\S]*<\\/?[A-Za-z][^>]*>)[\\s\\S]*$",
});
const PlainNoteSchema = Type.String({
  minLength: 1,
  maxLength: 5_000,
  pattern: "^(?![\\s\\S]*<\\/?[A-Za-z][^>]*>)[\\s\\S]*$",
});

export const SavedInvestigationScopeSchema = Type.Object(
  {
    range: InvestigationRangeSchema,
    query: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    statuses: Type.Optional(Type.Array(ExecutionStatusSchema, { minItems: 1, maxItems: 6 })),
    providers: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
        minItems: 1,
        maxItems: 20,
      }),
    ),
    models: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
        minItems: 1,
        maxItems: 20,
      }),
    ),
    errorCategory: Type.Optional(ProviderErrorCategorySchema),
    errorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    signal: Type.Optional(InvestigationSignalSchema),
  },
  { additionalProperties: false },
);
export type SavedInvestigationScope = Static<typeof SavedInvestigationScopeSchema>;

export const InvestigationCaseSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    caseId: Type.String(),
    tenantId: Type.String(),
    title: PlainTitleSchema,
    question: PlainQuestionSchema,
    status: InvestigationCaseStatusSchema,
    importance: Type.Optional(InvestigationCaseImportanceSchema),
    savedScope: SavedInvestigationScopeSchema,
    finding: Type.Optional(PlainFindingSchema),
    resolution: Type.Optional(PlainFindingSchema),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    resolvedAt: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);
export type InvestigationCase = Static<typeof InvestigationCaseSchema>;

export const InvestigationCaseNoteSchema = Type.Object(
  {
    noteId: Type.String(),
    caseId: Type.String(),
    body: PlainNoteSchema,
    createdAt: Type.String({ format: "date-time" }),
  },
  { additionalProperties: false },
);
export type InvestigationCaseNote = Static<typeof InvestigationCaseNoteSchema>;

export const InvestigationCaseEventTypeSchema = Type.Union([
  Type.Literal("case.created"),
  Type.Literal("case.updated"),
  Type.Literal("case.status_changed"),
  Type.Literal("case.finding_updated"),
  Type.Literal("case.resolution_updated"),
  Type.Literal("case.note_added"),
  Type.Literal("case.evidence_added"),
  Type.Literal("case.evidence_removed"),
]);
export type InvestigationCaseEventType = Static<typeof InvestigationCaseEventTypeSchema>;

const SafeMetadataValueSchema = Type.Union([
  Type.String({ maxLength: 512 }),
  Type.Number(),
  Type.Boolean(),
  Type.Null(),
]);
export const InvestigationCaseTimelineEventSchema = Type.Object(
  {
    eventId: Type.String(),
    caseId: Type.String(),
    type: InvestigationCaseEventTypeSchema,
    occurredAt: Type.String({ format: "date-time" }),
    metadata: Type.Record(Type.String(), SafeMetadataValueSchema),
  },
  { additionalProperties: false },
);
export type InvestigationCaseTimelineEvent = Static<typeof InvestigationCaseTimelineEventSchema>;

export const InvestigationCaseEvidenceInputSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("execution"),
      executionId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("comparison"),
      experimentId: Type.String({ minLength: 1, maxLength: 256 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal("provider_observation"),
      provider: Type.String({ minLength: 1, maxLength: 128 }),
      model: Type.String({ minLength: 1, maxLength: 256 }),
      range: InvestigationRangeSchema,
    },
    { additionalProperties: false },
  ),
]);
export type InvestigationCaseEvidenceInput = Static<typeof InvestigationCaseEvidenceInputSchema>;

const EvidenceBaseProperties = {
  evidenceId: Type.String(),
  caseId: Type.String(),
  addedAt: Type.String({ format: "date-time" }),
  url: Type.String(),
};
export const InvestigationCaseEvidenceSchema = Type.Union([
  Type.Object(
    {
      ...EvidenceBaseProperties,
      type: Type.Literal("execution"),
      executionId: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EvidenceBaseProperties,
      type: Type.Literal("comparison"),
      experimentId: Type.String(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EvidenceBaseProperties,
      type: Type.Literal("provider_observation"),
      provider: Type.String(),
      model: Type.String(),
      range: InvestigationRangeSchema,
    },
    { additionalProperties: false },
  ),
]);
export type InvestigationCaseEvidence = Static<typeof InvestigationCaseEvidenceSchema>;

export const InvestigationCaseEvidenceCountsSchema = Type.Object(
  {
    executions: Type.Integer({ minimum: 0 }),
    comparisons: Type.Integer({ minimum: 0 }),
    providerObservations: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type InvestigationCaseEvidenceCounts = Static<typeof InvestigationCaseEvidenceCountsSchema>;

export const InvestigationCaseSummarySchema = Type.Object(
  {
    case: InvestigationCaseSchema,
    evidenceCounts: InvestigationCaseEvidenceCountsSchema,
  },
  { additionalProperties: false },
);
export type InvestigationCaseSummary = Static<typeof InvestigationCaseSummarySchema>;

export const InvestigationCasePageSchema = Type.Object(
  {
    data: Type.Array(InvestigationCaseSummarySchema),
    total: Type.Integer({ minimum: 0 }),
    nextCursor: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type InvestigationCasePage = Static<typeof InvestigationCasePageSchema>;

export const InvestigationCaseDetailSchema = Type.Object(
  {
    case: InvestigationCaseSchema,
    notes: Type.Array(InvestigationCaseNoteSchema),
    evidence: Type.Array(InvestigationCaseEvidenceSchema),
    timeline: Type.Array(InvestigationCaseTimelineEventSchema),
    links: Type.Object(
      {
        self: Type.String(),
        savedWorkbench: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type InvestigationCaseDetail = Static<typeof InvestigationCaseDetailSchema>;

export const CreateInvestigationCaseBodySchema = Type.Object(
  {
    title: PlainTitleSchema,
    question: PlainQuestionSchema,
    importance: Type.Optional(InvestigationCaseImportanceSchema),
    savedScope: SavedInvestigationScopeSchema,
  },
  { additionalProperties: false },
);
export type CreateInvestigationCaseBody = Static<typeof CreateInvestigationCaseBodySchema>;

export const UpdateInvestigationCaseBodySchema = Type.Object(
  {
    title: Type.Optional(PlainTitleSchema),
    question: Type.Optional(PlainQuestionSchema),
    status: Type.Optional(InvestigationCaseStatusSchema),
    importance: Type.Optional(Type.Union([InvestigationCaseImportanceSchema, Type.Null()])),
    finding: Type.Optional(Type.Union([PlainFindingSchema, Type.Null()])),
    resolution: Type.Optional(Type.Union([PlainFindingSchema, Type.Null()])),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type UpdateInvestigationCaseBody = Static<typeof UpdateInvestigationCaseBodySchema>;

export const AddInvestigationCaseNoteBodySchema = Type.Object(
  { body: PlainNoteSchema },
  { additionalProperties: false },
);
export type AddInvestigationCaseNoteBody = Static<typeof AddInvestigationCaseNoteBodySchema>;
