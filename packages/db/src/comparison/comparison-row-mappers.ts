/** Translates comparison experiments between domain and PostgreSQL representations. */
import type { ComparisonExperiment } from "@reliability-lab/contracts";
import type { comparisonExperiments } from "../schema/comparisons.js";

export function toComparisonInsert(
  experiment: ComparisonExperiment,
): typeof comparisonExperiments.$inferInsert {
  return {
    id: experiment.experimentId,
    tenantId: experiment.tenantId,
    originalExecutionId: experiment.originalExecutionId,
    variantExecutionId: experiment.variantExecutionId,
    status: experiment.status,
    requestedVariation: experiment.requestedVariation,
    resolvedVariant: experiment.resolvedVariant,
    unavailableReason: experiment.unavailableReason,
    createdAt: new Date(experiment.createdAt),
    updatedAt: new Date(experiment.updatedAt),
  };
}

export function fromComparisonRow(
  row: typeof comparisonExperiments.$inferSelect,
): ComparisonExperiment {
  return {
    schemaVersion: 1,
    experimentId: row.id,
    tenantId: row.tenantId,
    originalExecutionId: row.originalExecutionId,
    status: row.status,
    requestedVariation: row.requestedVariation,
    resolvedVariant: row.resolvedVariant,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.variantExecutionId ? { variantExecutionId: row.variantExecutionId } : {}),
    ...(row.unavailableReason ? { unavailableReason: row.unavailableReason } : {}),
  };
}
