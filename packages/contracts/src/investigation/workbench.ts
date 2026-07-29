import { Type, type Static } from "@sinclair/typebox";
import { ExecutionStatusSchema, ProviderErrorCategorySchema } from "../execution/status.js";
import type { ExecutionStatus, ProviderErrorCategory } from "../execution/status.js";

/**
 * Bounded Investigation Workbench query and projection contracts.
 * They describe safe read models; database aggregation remains an adapter concern.
 */
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
