import { describe, expect, it } from "vitest";
import {
  ExecutionService,
  InvestigationCaseExperimentService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  MemoryReplayCapsuleStore,
  type InvestigationCaseExperimentDiagnostic,
} from "../src/index.js";
import { DeterministicFakeProvider } from "@reliability-lab/providers";

const RANGE = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-02T00:00:00.000Z",
};

function harness(options: { failNextComparisonLink?: boolean } = {}) {
  const executions = new MemoryExecutionRepository();
  const comparisons = new MemoryComparisonExperimentRepository();
  const cases = new MemoryInvestigationCaseRepository();
  if (options.failNextComparisonLink) {
    const addEvidence = cases.addEvidence.bind(cases);
    let shouldFail = true;
    cases.addEvidence = async (...arguments_) => {
      if (shouldFail && arguments_[1].type === "comparison") {
        shouldFail = false;
        throw new Error("SECRET forced link failure");
      }
      return addEvidence(...arguments_);
    };
  }
  const executionService = new ExecutionService({
    repository: executions,
    comparisons,
    replayCapsules: new MemoryReplayCapsuleStore(),
    providers: new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary" }),
      new DeterministicFakeProvider({ id: "fake-fallback" }),
    ]),
  });
  const caseService = new InvestigationCaseService({
    cases,
    executions,
    comparisons,
  });
  return { executions, comparisons, cases, executionService, caseService };
}

async function replayableExecution(executionService: ExecutionService, tenantId = "tenant-a") {
  return executionService.execute({
    tenantId,
    body: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "SECRET retained input",
    },
  });
}

async function caseWithExecution(
  caseService: InvestigationCaseService,
  executionId: string,
  tenantId = "tenant-a",
) {
  const created = await caseService.create(tenantId, {
    title: "Case-driven experiment",
    question: "Which bounded policy should we inspect?",
    savedScope: { range: RANGE },
  });
  const linked = await caseService.addEvidence(tenantId, created.case.caseId, {
    type: "execution",
    executionId,
  });
  return { caseId: created.case.caseId, evidenceId: linked.evidence.evidenceId };
}

describe("investigation case experiments", () => {
  it("creates one ordinary comparison and links it back with metadata-only timeline evidence", async () => {
    const { cases, executionService, caseService } = harness();
    const original = await replayableExecution(executionService);
    const selected = await caseWithExecution(caseService, original.executionId);
    const experiments = new InvestigationCaseExperimentService({
      cases: caseService,
      executions: executionService,
    });

    const submission = await experiments.create("tenant-a", selected.caseId, {
      executionEvidenceId: selected.evidenceId,
      variation: { reproducibilityCheck: true },
    });
    await submission.completion;
    const detail = await cases.get("tenant-a", selected.caseId);

    expect(submission.result).toMatchObject({
      kind: "comparison_linked",
      experiment: {
        originalExecutionId: original.executionId,
        requestedVariation: { reproducibilityCheck: true },
      },
    });
    expect(detail?.evidence.filter((item) => item.type === "comparison")).toEqual([
      expect.objectContaining({
        experimentId: submission.result.experiment.experimentId,
      }),
    ]);
    expect(detail?.timeline).toContainEqual(
      expect.objectContaining({
        type: "case.comparison_started",
        metadata: {
          experimentId: submission.result.experiment.experimentId,
          originalExecutionId: original.executionId,
          linkState: "linked",
        },
      }),
    );
    expect(JSON.stringify(detail)).not.toContain("SECRET retained input");
  });

  it("rejects evidence of the wrong type, another case, or another tenant before creation", async () => {
    const { executionService, caseService } = harness();
    const original = await replayableExecution(executionService);
    const selected = await caseWithExecution(caseService, original.executionId);
    const other = await caseWithExecution(caseService, original.executionId);
    const providerLink = await caseService.addEvidence("tenant-a", selected.caseId, {
      type: "provider_observation",
      provider: "fake-primary",
      model: "deterministic-v1",
      range: RANGE,
    });
    const experiments = new InvestigationCaseExperimentService({
      cases: caseService,
      executions: executionService,
    });

    await expect(
      experiments.create("tenant-a", selected.caseId, {
        executionEvidenceId: providerLink.evidence.evidenceId,
        variation: { reproducibilityCheck: true },
      }),
    ).rejects.toThrow("must be an execution already linked");
    await expect(
      experiments.create("tenant-a", selected.caseId, {
        executionEvidenceId: other.evidenceId,
        variation: { reproducibilityCheck: true },
      }),
    ).rejects.toThrow("must be an execution already linked");
    await expect(
      experiments.create("tenant-b", selected.caseId, {
        executionEvidenceId: selected.evidenceId,
        variation: { reproducibilityCheck: true },
      }),
    ).rejects.toThrow("Investigation case not found");
  });

  it("links an explicitly unavailable comparison as useful case evidence", async () => {
    const { executionService, caseService } = harness();
    const original = await replayableExecution(executionService);
    await executionService.deleteReplayCapsule("tenant-a", original.executionId);
    const selected = await caseWithExecution(caseService, original.executionId);
    const experiments = new InvestigationCaseExperimentService({
      cases: caseService,
      executions: executionService,
    });

    const submission = await experiments.create("tenant-a", selected.caseId, {
      executionEvidenceId: selected.evidenceId,
      variation: { reproducibilityCheck: true },
    });
    const detail = await caseService.get("tenant-a", selected.caseId);

    expect(submission.result).toMatchObject({
      kind: "comparison_linked",
      experiment: { status: "unavailable" },
    });
    expect(detail.evidence).toContainEqual(
      expect.objectContaining({
        type: "comparison",
        experimentId: submission.result.experiment.experimentId,
      }),
    );
  });

  it("returns an explicit partial state and recovers the existing comparison without duplication", async () => {
    const diagnostics: InvestigationCaseExperimentDiagnostic[] = [];
    const { comparisons, executionService, caseService } = harness({
      failNextComparisonLink: true,
    });
    const original = await replayableExecution(executionService);
    const selected = await caseWithExecution(caseService, original.executionId);
    const experiments = new InvestigationCaseExperimentService({
      cases: caseService,
      executions: executionService,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    const submission = await experiments.create("tenant-a", selected.caseId, {
      executionEvidenceId: selected.evidenceId,
      variation: { reproducibilityCheck: true },
    });
    expect(submission.result.kind).toBe("comparison_created_link_failed");
    const experimentId = submission.result.experiment.experimentId;
    expect(await comparisons.findById("tenant-a", experimentId)).not.toBeNull();
    expect((await caseService.get("tenant-a", selected.caseId)).timeline).toContainEqual(
      expect.objectContaining({
        type: "case.comparison_link_failed",
        metadata: {
          experimentId,
          originalExecutionId: original.executionId,
          linkState: "unlinked",
        },
      }),
    );

    await caseService.addEvidence("tenant-a", selected.caseId, {
      type: "comparison",
      experimentId,
    });
    await caseService.addEvidence("tenant-a", selected.caseId, {
      type: "comparison",
      experimentId,
    });
    const recovered = await caseService.get("tenant-a", selected.caseId);

    expect(
      recovered.evidence.filter(
        (item) => item.type === "comparison" && item.experimentId === experimentId,
      ),
    ).toHaveLength(1);
    expect(diagnostics).toEqual([
      {
        caseId: selected.caseId,
        experimentId,
        operation: "link_comparison_evidence",
        errorName: "Error",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("SECRET");
  });
});
