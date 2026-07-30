import { Type, type Static } from "@sinclair/typebox";
import { ExecutionBudgetSchema, ExecutionPolicySchema } from "../execution/policy.js";
import { ExecutionStatusSchema, FailureModeSchema } from "../execution/status.js";
import { ReplayCapabilityStateSchema } from "../replay/capability.js";
import { ReplayVariationSchema } from "../replay/replay.js";
import {
  InvestigationCaseEvidenceInputSchema,
  InvestigationCaseSchema,
  SavedInvestigationScopeSchema,
} from "./cases.js";
import {
  ExecutionSummarySchema,
  InvestigationRangeSchema,
  ProviderObservationSchema,
} from "./workbench.js";

/**
 * Portable case-review projections expose bounded current evidence and record-completeness checks.
 * They deliberately exclude raw execution, replay, note, and provider payloads.
 */
export const CaseEvidenceAvailabilitySchema = Type.Union([
  Type.Literal("available"),
  Type.Literal("unavailable"),
]);
export type CaseEvidenceAvailability = Static<typeof CaseEvidenceAvailabilitySchema>;

export const CaseEvidenceUnavailableReasonSchema = Type.Union([
  Type.Literal("authoritative_evidence_not_found"),
  Type.Literal("current_read_unavailable"),
  Type.Literal("no_matching_observation"),
  Type.Literal("unsupported_historical_schema"),
]);
export type CaseEvidenceUnavailableReason = Static<typeof CaseEvidenceUnavailableReasonSchema>;

export const ConclusionReadinessCheckIdSchema = Type.Union([
  Type.Literal("exact_scope_present"),
  Type.Literal("evidence_linked"),
  Type.Literal("evidence_reviewed"),
  Type.Literal("finding_present"),
  Type.Literal("resolution_present"),
]);
export type ConclusionReadinessCheckId = Static<typeof ConclusionReadinessCheckIdSchema>;

export const ConclusionReadinessCheckSchema = Type.Object(
  {
    id: ConclusionReadinessCheckIdSchema,
    satisfied: Type.Boolean(),
    label: Type.String(),
    explanation: Type.String(),
  },
  { additionalProperties: false },
);
export type ConclusionReadinessCheck = Static<typeof ConclusionReadinessCheckSchema>;

export const ConclusionReadinessSchema = Type.Object(
  {
    ready: Type.Boolean(),
    checks: Type.Array(ConclusionReadinessCheckSchema, { minItems: 5, maxItems: 5 }),
  },
  { additionalProperties: false },
);
export type ConclusionReadiness = Static<typeof ConclusionReadinessSchema>;

const ReplayCapabilitySummarySchema = Type.Object(
  {
    state: ReplayCapabilityStateSchema,
    available: Type.Boolean(),
    reason: Type.String(),
    expiresAt: Type.Optional(Type.String({ format: "date-time" })),
    deletedAt: Type.Optional(Type.String({ format: "date-time" })),
  },
  { additionalProperties: false },
);

export const CaseExecutionEvidenceSummarySchema = Type.Object(
  {
    ...ExecutionSummarySchema.properties,
    replayCapability: ReplayCapabilitySummarySchema,
  },
  { additionalProperties: false },
);
export type CaseExecutionEvidenceSummary = Static<typeof CaseExecutionEvidenceSummarySchema>;

const ResolvedReplayConfigurationSchema = Type.Object(
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

export const ComparisonConditionStateSchema = Type.Union([
  Type.Literal("changed"),
  Type.Literal("inherited"),
]);
export type ComparisonConditionState = Static<typeof ComparisonConditionStateSchema>;

export const ComparisonConditionReviewSchema = Type.Object(
  {
    key: Type.String(),
    label: Type.String(),
    state: ComparisonConditionStateSchema,
  },
  { additionalProperties: false },
);
export type ComparisonConditionReview = Static<typeof ComparisonConditionReviewSchema>;

const ComparisonDimensionReviewSchema = Type.Object(
  {
    key: Type.String(),
    label: Type.String(),
    original: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    variant: Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
    change: Type.Union([
      Type.Literal("improved"),
      Type.Literal("worsened"),
      Type.Literal("unchanged"),
      Type.Literal("mixed"),
      Type.Literal("unavailable"),
    ]),
    explanation: Type.String(),
  },
  { additionalProperties: false },
);

export const CaseComparisonEvidenceSummarySchema = Type.Object(
  {
    experimentId: Type.String(),
    status: Type.Union([
      Type.Literal("running"),
      Type.Literal("completed"),
      Type.Literal("unavailable"),
    ]),
    originalExecutionId: Type.String(),
    originalStatus: ExecutionStatusSchema,
    variantExecutionId: Type.Optional(Type.String()),
    variantStatus: Type.Optional(ExecutionStatusSchema),
    requestedVariation: ReplayVariationSchema,
    resolvedVariant: ResolvedReplayConfigurationSchema,
    conditions: Type.Array(ComparisonConditionReviewSchema),
    summary: Type.String(),
    dimensions: Type.Array(ComparisonDimensionReviewSchema),
    createdAt: Type.String({ format: "date-time" }),
    updatedAt: Type.String({ format: "date-time" }),
    unavailableReason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type CaseComparisonEvidenceSummary = Static<typeof CaseComparisonEvidenceSummarySchema>;

export const CaseProviderObservationEvidenceSummarySchema = Type.Object(
  {
    provider: Type.String(),
    model: Type.String(),
    range: InvestigationRangeSchema,
    observation: ProviderObservationSchema,
  },
  { additionalProperties: false },
);
export type CaseProviderObservationEvidenceSummary = Static<
  typeof CaseProviderObservationEvidenceSummarySchema
>;

const ReviewItemBaseProperties = {
  evidenceId: Type.String(),
  caseId: Type.String(),
  addedAt: Type.String({ format: "date-time" }),
  sourceUrl: Type.String(),
};

export const AvailableCaseEvidenceReviewItemSchema = Type.Union([
  Type.Object(
    {
      ...ReviewItemBaseProperties,
      type: Type.Literal("execution"),
      availability: Type.Literal("available"),
      reference: Type.Object(
        { type: Type.Literal("execution"), executionId: Type.String() },
        { additionalProperties: false },
      ),
      summary: CaseExecutionEvidenceSummarySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ReviewItemBaseProperties,
      type: Type.Literal("comparison"),
      availability: Type.Literal("available"),
      reference: Type.Object(
        { type: Type.Literal("comparison"), experimentId: Type.String() },
        { additionalProperties: false },
      ),
      summary: CaseComparisonEvidenceSummarySchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ReviewItemBaseProperties,
      type: Type.Literal("provider_observation"),
      availability: Type.Literal("available"),
      reference: Type.Object(
        {
          type: Type.Literal("provider_observation"),
          provider: Type.String(),
          model: Type.String(),
          range: InvestigationRangeSchema,
        },
        { additionalProperties: false },
      ),
      summary: CaseProviderObservationEvidenceSummarySchema,
    },
    { additionalProperties: false },
  ),
]);
export type AvailableCaseEvidenceReviewItem = Static<typeof AvailableCaseEvidenceReviewItemSchema>;

export const UnavailableCaseEvidenceReviewItemSchema = Type.Object(
  {
    ...ReviewItemBaseProperties,
    type: Type.Union([
      Type.Literal("execution"),
      Type.Literal("comparison"),
      Type.Literal("provider_observation"),
    ]),
    availability: Type.Literal("unavailable"),
    reference: InvestigationCaseEvidenceInputSchema,
    reason: CaseEvidenceUnavailableReasonSchema,
    explanation: Type.String(),
  },
  { additionalProperties: false },
);
export type UnavailableCaseEvidenceReviewItem = Static<
  typeof UnavailableCaseEvidenceReviewItemSchema
>;

export const CaseEvidenceReviewItemSchema = Type.Union([
  AvailableCaseEvidenceReviewItemSchema,
  UnavailableCaseEvidenceReviewItemSchema,
]);
export type CaseEvidenceReviewItem = Static<typeof CaseEvidenceReviewItemSchema>;

export const InvestigationCaseReviewSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    generatedAt: Type.String({ format: "date-time" }),
    case: InvestigationCaseSchema,
    scope: SavedInvestigationScopeSchema,
    noteCount: Type.Integer({ minimum: 0 }),
    evidence: Type.Array(CaseEvidenceReviewItemSchema),
    readiness: ConclusionReadinessSchema,
    links: Type.Object(
      {
        self: Type.String(),
        packet: Type.String(),
        savedWorkbench: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type InvestigationCaseReview = Static<typeof InvestigationCaseReviewSchema>;
