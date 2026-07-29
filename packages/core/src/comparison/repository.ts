import type {
  ComparisonExperiment as ComparisonExperimentContract,
  TenantId,
} from "@reliability-lab/contracts";

/**
 * Persistence boundary for comparison experiment definitions.
 * Execution evidence remains behind ExecutionRepository.
 */
export interface ComparisonExperimentRepository {
  create(experiment: ComparisonExperimentContract): Promise<void>;
  update(experiment: ComparisonExperimentContract): Promise<void>;
  findById(tenantId: TenantId, experimentId: string): Promise<ComparisonExperimentContract | null>;
}

export class MemoryComparisonExperimentRepository implements ComparisonExperimentRepository {
  readonly #experiments = new Map<string, ComparisonExperimentContract>();

  async create(experiment: ComparisonExperimentContract) {
    this.#experiments.set(experiment.experimentId, structuredClone(experiment));
  }

  async update(experiment: ComparisonExperimentContract) {
    this.#experiments.set(experiment.experimentId, structuredClone(experiment));
  }

  async findById(tenantId: TenantId, experimentId: string) {
    const experiment = this.#experiments.get(experimentId);
    return experiment?.tenantId === tenantId ? structuredClone(experiment) : null;
  }
}
