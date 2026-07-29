import { Type } from "@sinclair/typebox";
import {
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
