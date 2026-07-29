import {
  ExecutionService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  MemoryInvestigationReadRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import { buildApp } from "../../src/app.js";

export async function buildTestApp() {
  const repository = new MemoryExecutionRepository();
  const comparisons = new MemoryComparisonExperimentRepository();
  const service = new ExecutionService({
    repository,
    comparisons,
    replayCapsules: new MemoryReplayCapsuleStore(),
    providers: new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary" }),
      new DeterministicFakeProvider({ id: "fake-fallback" }),
    ]),
  });
  const app = await buildApp({
    service,
    investigationCases: new InvestigationCaseService({
      cases: new MemoryInvestigationCaseRepository(),
      executions: repository,
      comparisons,
    }),
    investigations: new MemoryInvestigationReadRepository(repository),
    logger: false,
    enableFailureInjection: true,
  });
  return { app, service };
}

export async function waitForTerminal(
  service: ExecutionService,
  tenantId: string,
  executionId: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const execution = await service.get(tenantId, executionId);
    if (["succeeded", "degraded", "failed", "cancelled"].includes(execution.status)) {
      return execution;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Execution did not reach a terminal state");
}

export function sseEvents(body: string): Array<{ sequence: number; type: string }> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as { sequence: number; type: string });
}
