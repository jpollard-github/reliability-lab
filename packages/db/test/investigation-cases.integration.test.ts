import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  encodeCaseCursor,
  ExecutionService,
  InvestigationCaseExperimentService,
  InvestigationCaseReviewService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import {
  investigationCaseEvidence,
  investigationCaseEvents,
  investigationCaseNotes,
  investigationCases,
  PostgresComparisonExperimentRepository,
  PostgresExecutionRepository,
  PostgresInvestigationCaseRepository,
  PostgresInvestigationReadRepository,
} from "../src/index.js";
import { useIntegrationDatabase } from "./support/database.js";

describe("Postgres saved investigation cases", () => {
  const connection = useIntegrationDatabase();

  it("persists tenant-scoped saved cases, linked evidence, notes, and metadata timelines", async () => {
    if (!connection) return;
    const tenantId = `case-${randomUUID()}`;
    const otherTenant = `${tenantId}-other`;
    const promptMarker = `prohibited-prompt-${randomUUID()}`;
    const executionRepository = new PostgresExecutionRepository(connection.db);
    const comparisonRepository = new PostgresComparisonExperimentRepository(connection.db);
    const replayCapsules = new MemoryReplayCapsuleStore();
    const executionService = new ExecutionService({
      repository: executionRepository,
      comparisons: comparisonRepository,
      replayCapsules,
      providers: new MapProviderRegistry([
        new DeterministicFakeProvider({ id: "fake-primary" }),
        new DeterministicFakeProvider({ id: "fake-fallback" }),
      ]),
    });
    const original = await executionService.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: promptMarker,
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const otherExecution = await executionService.execute({
      tenantId: otherTenant,
      body: { provider: "fake-primary", model: "v1", input: "other tenant" },
    });
    const comparison = await executionService.createComparison(tenantId, original.executionId, {
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    });
    await comparison.completion;

    const fixedNow = new Date();
    const repository = new PostgresInvestigationCaseRepository(connection.db);
    const caseService = new InvestigationCaseService({
      cases: repository,
      executions: executionRepository,
      comparisons: comparisonRepository,
      now: () => fixedNow,
    });
    const range = {
      from: new Date(fixedNow.getTime() - 60_000).toISOString(),
      to: new Date(fixedNow.getTime() + 60_000).toISOString(),
    };
    const created = await caseService.create(tenantId, {
      title: "Retry evidence",
      question: "Did bounded retry recover the selected execution?",
      importance: "notable",
      savedScope: {
        range,
        statuses: ["succeeded", "succeeded"],
        providers: ["fake-primary"],
        signal: "retry_recovered",
      },
    });
    await caseService.create(tenantId, {
      title: "Fallback evidence",
      question: "Was fallback selected?",
      savedScope: { range, signal: "fallback_used" },
    });
    await caseService.create(tenantId, {
      title: "Provider evidence",
      question: "Was the route unavailable?",
      savedScope: { range, errorCategory: "provider_unavailable" },
    });
    const executionLink = await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "execution",
      executionId: original.executionId,
    });
    const duplicate = await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "execution",
      executionId: original.executionId,
    });
    expect(duplicate).toEqual({ evidence: executionLink.evidence, added: false });
    const caseExperiment = await new InvestigationCaseExperimentService({
      cases: caseService,
      executions: executionService,
    }).create(tenantId, created.case.caseId, {
      executionEvidenceId: executionLink.evidence.evidenceId,
      variation: { reproducibilityCheck: true },
    });
    await caseExperiment.completion;
    expect(caseExperiment.result.kind).toBe("comparison_linked");
    await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "comparison",
      experimentId: comparison.experiment.experimentId,
    });
    await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "provider_observation",
      provider: "fake-primary",
      model: "v1",
      range,
    });
    await caseService.addNote(tenantId, created.case.caseId, {
      body: "Second attempt recovered without fallback.",
    });
    await caseService.update(tenantId, created.case.caseId, {
      status: "resolved",
      finding: "The selected retry recovered.",
      resolution: "Keep bounded retry.",
    });

    const reconstructed = new InvestigationCaseService({
      cases: new PostgresInvestigationCaseRepository(connection.db),
      executions: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      now: () => fixedNow,
    });
    const detail = await reconstructed.get(tenantId, created.case.caseId);
    expect(detail).toMatchObject({
      case: {
        status: "resolved",
        resolvedAt: fixedNow.toISOString(),
        savedScope: { statuses: ["succeeded"] },
      },
      notes: [{ body: "Second attempt recovered without fallback." }],
    });
    expect(detail.evidence.map((item) => item.type).sort()).toEqual([
      "comparison",
      "comparison",
      "execution",
      "provider_observation",
    ]);
    expect(detail.timeline).toContainEqual(
      expect.objectContaining({
        type: "case.comparison_started",
        metadata: expect.objectContaining({
          experimentId: caseExperiment.result.experiment.experimentId,
          linkState: "linked",
        }),
      }),
    );
    expect(JSON.stringify(detail.timeline)).not.toContain("Second attempt recovered");
    expect(JSON.stringify(detail.timeline)).not.toContain("The selected retry recovered");
    const review = await new InvestigationCaseReviewService({
      cases: new PostgresInvestigationCaseRepository(connection.db),
      executions: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      investigations: new PostgresInvestigationReadRepository(connection.db),
      replayCapsules,
      now: () => fixedNow,
    }).get(tenantId, created.case.caseId);
    expect(review.evidence.map((item) => item.evidenceId)).toEqual(
      detail.evidence.map((item) => item.evidenceId),
    );
    expect(review.evidence.find((item) => item.type === "provider_observation")).toMatchObject({
      availability: "available",
      summary: {
        provider: "fake-primary",
        model: "v1",
        range,
      },
    });
    expect(review.readiness.ready).toBe(true);
    expect(JSON.stringify(review)).not.toContain(promptMarker);
    await expect(
      new InvestigationCaseReviewService({
        cases: new PostgresInvestigationCaseRepository(connection.db),
        executions: new PostgresExecutionRepository(connection.db),
        comparisons: new PostgresComparisonExperimentRepository(connection.db),
        investigations: new PostgresInvestigationReadRepository(connection.db),
        replayCapsules,
      }).get(otherTenant, created.case.caseId),
    ).rejects.toThrow("Investigation case not found");
    await expect(reconstructed.get(otherTenant, created.case.caseId)).rejects.toThrow(
      "Investigation case not found",
    );
    await expect(
      reconstructed.addEvidence(tenantId, created.case.caseId, {
        type: "execution",
        executionId: otherExecution.executionId,
      }),
    ).rejects.toThrow("Investigation case not found");

    const firstPage = await reconstructed.list(tenantId, { limit: 2 });
    expect(firstPage).toMatchObject({ total: 3 });
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await reconstructed.list(tenantId, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.data).toHaveLength(1);
    const last = secondPage.data[0]!.case;
    const emptyPage = await reconstructed.list(tenantId, {
      limit: 2,
      cursor: encodeCaseCursor(last.updatedAt, last.caseId),
    });
    expect(emptyPage).toMatchObject({ data: [], total: 3 });
    const filtered = await reconstructed.list(tenantId, {
      statuses: ["resolved"],
      importance: "notable",
      query: "retry",
      executionId: original.executionId,
    });
    expect(filtered.data.map((item) => item.case.caseId)).toEqual([created.case.caseId]);

    await reconstructed.removeEvidence(
      tenantId,
      created.case.caseId,
      executionLink.evidence.evidenceId,
    );
    expect(await executionRepository.findById(tenantId, original.executionId)).not.toBeNull();
    const archived = await reconstructed.update(tenantId, created.case.caseId, {
      status: "archived",
    });
    expect(archived.case).toMatchObject({ status: "archived" });
    expect(archived.case.resolvedAt).toBeUndefined();
    expect(archived.timeline.at(-2)?.type).toBe("case.updated");
    expect(archived.timeline.at(-1)?.type).toBe("case.status_changed");

    const [caseRows, noteRows, evidenceRows, eventRows] = await Promise.all([
      connection.db
        .select()
        .from(investigationCases)
        .where(eq(investigationCases.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseNotes)
        .where(eq(investigationCaseNotes.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseEvidence)
        .where(eq(investigationCaseEvidence.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseEvents)
        .where(eq(investigationCaseEvents.tenantId, tenantId)),
    ]);
    expect(JSON.stringify({ caseRows, noteRows, evidenceRows, eventRows })).not.toContain(
      promptMarker,
    );
    expect(JSON.stringify(eventRows)).not.toContain("Second attempt recovered");
    expect(JSON.stringify(eventRows)).not.toContain("The selected retry recovered");

    const indexes = await connection.db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'investigation_cases'
    `);
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "investigation_cases_tenant_status_updated_idx",
    );
  });
});
