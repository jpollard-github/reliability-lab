import { Type, type Static } from "@sinclair/typebox";
import { ExecutionStatusSchema, ProviderErrorCategorySchema } from "../execution/status.js";
import { InvestigationRangeSchema, InvestigationSignalSchema } from "./workbench.js";

/**
 * Saved investigation case, evidence, note, timeline, and API-body contracts.
 * Cases preserve bounded prose and references, never copied execution or replay payloads.
 */
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
  Type.Literal("case.comparison_started"),
  Type.Literal("case.comparison_link_failed"),
  Type.Literal("case.comparison_link_recovered"),
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
