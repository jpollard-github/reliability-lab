/** Owns persisted comparative-replay experiment definitions and their execution references. */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type {
  ComparisonExperimentStatus,
  ReplayVariation,
  ResolvedReplayConfiguration,
} from "@reliability-lab/contracts";
import { executions } from "./executions.js";

export const comparisonExperiments = pgTable(
  "comparison_experiments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    originalExecutionId: text("original_execution_id")
      .notNull()
      .references(() => executions.id),
    variantExecutionId: text("variant_execution_id").references(() => executions.id),
    status: text("status").$type<ComparisonExperimentStatus>().notNull(),
    requestedVariation: jsonb("requested_variation").$type<ReplayVariation>().notNull(),
    resolvedVariant: jsonb("resolved_variant").$type<ResolvedReplayConfiguration>().notNull(),
    unavailableReason: text("unavailable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("comparison_experiments_tenant_id_id_idx").on(table.tenantId, table.id),
    index("comparison_experiments_original_idx").on(table.tenantId, table.originalExecutionId),
    index("comparison_experiments_variant_idx").on(table.tenantId, table.variantExecutionId),
  ],
);
