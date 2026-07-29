/** Owns tenant-scoped comparison experiment persistence; projection policy remains in core. */
import { and, eq } from "drizzle-orm";
import type { ComparisonExperiment, TenantId } from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository } from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import { comparisonExperiments } from "../schema/comparisons.js";
import { fromComparisonRow, toComparisonInsert } from "./comparison-row-mappers.js";

export class PostgresComparisonExperimentRepository implements ComparisonExperimentRepository {
  readonly #db: ReliabilityDatabase;

  constructor(db: ReliabilityDatabase) {
    this.#db = db;
  }

  async create(experiment: ComparisonExperiment) {
    await this.#db.insert(comparisonExperiments).values(toComparisonInsert(experiment));
  }

  async update(experiment: ComparisonExperiment) {
    await this.#db
      .update(comparisonExperiments)
      .set({
        variantExecutionId: experiment.variantExecutionId ?? null,
        status: experiment.status,
        unavailableReason: experiment.unavailableReason ?? null,
        updatedAt: new Date(experiment.updatedAt),
      })
      .where(
        and(
          eq(comparisonExperiments.tenantId, experiment.tenantId),
          eq(comparisonExperiments.id, experiment.experimentId),
        ),
      );
  }

  async findById(tenantId: TenantId, experimentId: string) {
    const [row] = await this.#db
      .select()
      .from(comparisonExperiments)
      .where(
        and(
          eq(comparisonExperiments.tenantId, tenantId),
          eq(comparisonExperiments.id, experimentId),
        ),
      )
      .limit(1);
    return row ? fromComparisonRow(row) : null;
  }
}
