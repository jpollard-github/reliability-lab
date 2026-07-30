import { Type } from "@sinclair/typebox";
import {
  InvestigationCaseComparisonResultSchema,
  InvestigationCaseEvidenceSchema,
  InvestigationCaseImportanceSchema,
  InvestigationCaseStatusSchema,
} from "@reliability-lab/contracts";

export const InvestigationCaseParamsSchema = Type.Object({
  caseId: Type.String({ minLength: 1, maxLength: 256 }),
});

export const InvestigationCaseEvidenceParamsSchema = Type.Object({
  caseId: Type.String({ minLength: 1, maxLength: 256 }),
  evidenceId: Type.String({ minLength: 1, maxLength: 256 }),
});

export const InvestigationCaseListQuerySchema = Type.Object(
  {
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 25 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    status: Type.Optional(Type.Array(InvestigationCaseStatusSchema, { minItems: 1, maxItems: 4 })),
    importance: Type.Optional(InvestigationCaseImportanceSchema),
    q: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    executionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

export const InvestigationCaseEvidenceResultSchema = Type.Object(
  {
    evidence: InvestigationCaseEvidenceSchema,
    added: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const InvestigationCaseEvidenceRemovedSchema = Type.Object(
  { removed: Type.Literal(true) },
  { additionalProperties: false },
);

export const InvestigationCaseComparisonResponseSchema = Type.Object(
  {
    result: InvestigationCaseComparisonResultSchema,
    links: Type.Object(
      {
        case: Type.String(),
        comparison: Type.String(),
        originalExecution: Type.String(),
        variantExecution: Type.Optional(Type.String()),
        manualEvidenceLink: Type.Optional(
          Type.Object(
            {
              href: Type.String(),
              method: Type.Literal("POST"),
              body: Type.Object(
                {
                  type: Type.Literal("comparison"),
                  experimentId: Type.String(),
                },
                { additionalProperties: false },
              ),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
