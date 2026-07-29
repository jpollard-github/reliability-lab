import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import {
  PostgresComparisonExperimentRepository,
  PostgresExecutionRepository,
} from "../src/index.js";
import { useIntegrationDatabase } from "./support/database.js";

describe("Postgres comparison repository", () => {
  const connection = useIntegrationDatabase();

  it("persists comparative replay definitions and reconstructs their evidence", async () => {
    if (!connection) return;
    const tenantId = `comparison-${randomUUID()}`;
    const replayCapsules = new MemoryReplayCapsuleStore();
    const providers = new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary" }),
      new DeterministicFakeProvider({ id: "fake-fallback" }),
    ]);
    const service = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      replayCapsules,
      providers,
    });
    const original = await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "durable comparison",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const comparison = await service.createComparison(tenantId, original.executionId, {
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    });
    await comparison.completion;

    const reconstructed = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      replayCapsules,
      providers,
    });
    const view = await reconstructed.getComparison(tenantId, comparison.experiment.experimentId);
    expect(view).toMatchObject({
      experiment: { status: "completed", originalExecutionId: original.executionId },
      variantExecution: { replayOfExecutionId: original.executionId, status: "degraded" },
    });
    await expect(
      reconstructed.getComparison("different-tenant", comparison.experiment.experimentId),
    ).rejects.toThrow("Comparison experiment not found");
  });
});
