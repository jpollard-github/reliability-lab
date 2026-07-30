import { Type, type Static } from "@sinclair/typebox";
import { ComparisonExperimentSchema } from "../comparison/experiment.js";
import { ReplayVariationSchema } from "../replay/replay.js";

/**
 * Portable case-driven comparison command and explicit create/link outcome states.
 * Results contain identifiers and safe experiment conditions, never retained execution input.
 */
export const CreateInvestigationCaseComparisonBodySchema = Type.Object(
  {
    executionEvidenceId: Type.String({ minLength: 1, maxLength: 256 }),
    variation: ReplayVariationSchema,
  },
  { additionalProperties: false },
);
export type CreateInvestigationCaseComparisonBody = Static<
  typeof CreateInvestigationCaseComparisonBodySchema
>;

export const InvestigationCaseComparisonLinkedResultSchema = Type.Object(
  {
    kind: Type.Literal("comparison_linked"),
    experiment: ComparisonExperimentSchema,
    evidenceId: Type.String(),
  },
  { additionalProperties: false },
);
export type InvestigationCaseComparisonLinkedResult = Static<
  typeof InvestigationCaseComparisonLinkedResultSchema
>;

export const InvestigationCaseComparisonCreatedLinkFailedResultSchema = Type.Object(
  {
    kind: Type.Literal("comparison_created_link_failed"),
    experiment: ComparisonExperimentSchema,
    recovery: Type.Object(
      {
        kind: Type.Literal("link_existing_comparison"),
        experimentId: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type InvestigationCaseComparisonCreatedLinkFailedResult = Static<
  typeof InvestigationCaseComparisonCreatedLinkFailedResultSchema
>;

export const InvestigationCaseComparisonResultSchema = Type.Union([
  InvestigationCaseComparisonLinkedResultSchema,
  InvestigationCaseComparisonCreatedLinkFailedResultSchema,
]);
export type InvestigationCaseComparisonResult = Static<
  typeof InvestigationCaseComparisonResultSchema
>;
