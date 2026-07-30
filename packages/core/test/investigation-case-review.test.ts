import { describe, expect, it } from "vitest";
import type {
  ComparisonExperiment,
  ExecutionEnvelope,
  InvestigationCase,
  InvestigationCaseEvidence,
  InvestigationCaseTimelineEvent,
} from "@reliability-lab/contracts";
import {
  InvestigationCaseReviewService,
  InvestigationCaseService,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  MemoryInvestigationReadRepository,
  MemoryReplayCapsuleStore,
  caseReviewPacketFilename,
  renderInvestigationCaseReviewPacket,
} from "../src/index.js";

const RANGE = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-02T00:00:00.000Z",
};

function harness() {
  const cases = new MemoryInvestigationCaseRepository();
  const executions = new MemoryExecutionRepository();
  const comparisons = new MemoryComparisonExperimentRepository();
  const investigations = new MemoryInvestigationReadRepository(executions);
  const replayCapsules = new MemoryReplayCapsuleStore();
  let sequence = 0;
  const caseService = new InvestigationCaseService({
    cases,
    executions,
    comparisons,
    now: () => new Date("2026-07-02T12:00:00.000Z"),
    id: () => `id-${++sequence}`,
  });
  const reviews = new InvestigationCaseReviewService({
    cases,
    executions,
    comparisons,
    investigations,
    replayCapsules,
    now: () => new Date("2026-07-02T13:00:00.000Z"),
  });
  return { cases, executions, comparisons, caseService, reviews };
}

describe("investigation case review", () => {
  it("resolves every evidence type in persisted order with bounded safe summaries", async () => {
    const { executions, comparisons, caseService, reviews } = harness();
    await executions.create(execution("original", "degraded"));
    await executions.create(execution("variant", "succeeded"));
    await comparisons.create(comparison());
    const created = await caseService.create("tenant-a", {
      title: "Evidence-backed conclusion",
      question: "Which bounded policy handled the selected evidence?",
      savedScope: { range: RANGE, signal: "fallback_used" },
    });
    await caseService.addEvidence("tenant-a", created.case.caseId, {
      type: "execution",
      executionId: "original",
    });
    await caseService.addEvidence("tenant-a", created.case.caseId, {
      type: "comparison",
      experimentId: "comparison-1",
    });
    await caseService.addEvidence("tenant-a", created.case.caseId, {
      type: "provider_observation",
      provider: "fake-primary",
      model: "v1",
      range: RANGE,
    });
    await caseService.update("tenant-a", created.case.caseId, {
      finding: "Fallback changed the recorded outcome.",
      resolution: "Retain the bounded comparison for review.",
    });

    const review = await reviews.get("tenant-a", created.case.caseId);

    expect(review.evidence.map((item) => item.type)).toEqual([
      "execution",
      "comparison",
      "provider_observation",
    ]);
    expect(review.evidence.every((item) => item.availability === "available")).toBe(true);
    expect(review.readiness.ready).toBe(true);
    expect(review.readiness.checks.map((check) => check.id)).toEqual([
      "exact_scope_present",
      "evidence_linked",
      "evidence_reviewed",
      "finding_present",
      "resolution_present",
    ]);
    const executionItem = review.evidence[0]!;
    expect(executionItem).toMatchObject({
      availability: "available",
      summary: {
        executionId: "original",
        status: "degraded",
        initialProvider: "fake-primary",
        attemptCount: 1,
        replayCapability: { state: "missing", available: false },
      },
    });
    expect(JSON.stringify(executionItem)).not.toContain("SECRET_OUTPUT");
    expect(JSON.stringify(executionItem)).not.toContain("requestHash");
    expect(review.evidence[1]).toMatchObject({
      availability: "available",
      summary: {
        experimentId: "comparison-1",
        originalExecutionId: "original",
        variantExecutionId: "variant",
      },
    });
    expect(review.evidence[2]).toMatchObject({
      availability: "available",
      summary: {
        provider: "fake-primary",
        model: "v1",
        range: RANGE,
        observation: { attemptCount: 2, executionCount: 2 },
      },
    });
  });

  it("keeps missing references explicit and hides a wrong-tenant case as not found", async () => {
    const { cases, reviews } = harness();
    const item = caseRecord({ title: "Unavailable evidence" });
    await cases.create(item, createdEvent(item.caseId));
    await cases.addEvidence(
      "tenant-a",
      evidence("missing-execution"),
      "execution:missing-execution",
      evidenceEvent(item.caseId),
    );

    const review = await reviews.get("tenant-a", item.caseId);
    expect(review.evidence).toEqual([
      expect.objectContaining({
        availability: "unavailable",
        reason: "authoritative_evidence_not_found",
        reference: { type: "execution", executionId: "missing-execution" },
      }),
    ]);
    await expect(reviews.get("tenant-b", item.caseId)).rejects.toThrow(
      "Investigation case not found",
    );
  });

  it("keeps historical inconsistent resolved records readable but not ready", async () => {
    const { cases, reviews } = harness();
    const item = caseRecord({ status: "resolved", resolvedAt: "2026-07-02T00:00:00.000Z" });
    await cases.create(item, createdEvent(item.caseId));

    const review = await reviews.get("tenant-a", item.caseId);

    expect(review.case.status).toBe("resolved");
    expect(review.readiness.ready).toBe(false);
    expect(
      review.readiness.checks.filter((check) => !check.satisfied).map((check) => check.id),
    ).toEqual(["evidence_linked", "finding_present", "resolution_present"]);
  });

  it("renders deterministic escaped Markdown without note or execution bodies", async () => {
    const { executions, caseService, reviews } = harness();
    await executions.create(execution("original", "succeeded"));
    const created = await caseService.create("tenant-a", {
      title: "# Review [link](https://example.invalid)",
      question: "Question\n# injected heading",
      savedScope: { range: RANGE },
    });
    await caseService.addEvidence("tenant-a", created.case.caseId, {
      type: "execution",
      executionId: "original",
    });
    await caseService.addNote("tenant-a", created.case.caseId, {
      body: "SECRET_NOTE_BODY",
    });
    const review = await reviews.get("tenant-a", created.case.caseId);

    const first = renderInvestigationCaseReviewPacket(review);
    const second = renderInvestigationCaseReviewPacket(review);

    expect(first).toBe(second);
    expect(first).toContain("\\# Review \\[link\\]\\(https://example\\.invalid\\)");
    expect(first).toContain("Question\n\\# injected heading");
    expect(first).toContain("1 append-only note exists");
    expect(first).not.toContain("SECRET_NOTE_BODY");
    expect(first).not.toContain("SECRET_OUTPUT");
    expect(first).not.toContain("SECRET_REQUEST_HASH");
    expect(first).not.toContain("](https://example.invalid)");
    expect(first).toContain("from=2026-07-01T00%3A00%3A00.000Z");
    expect(first).not.toContain("%253A");
    expect(caseReviewPacketFilename("../unsafe case")).toBe("reliability-case-..-unsafe-case.md");
  });
});

function execution(executionId: string, status: ExecutionEnvelope["status"]): ExecutionEnvelope {
  return {
    schemaVersion: 1,
    executionId,
    tenantId: "tenant-a",
    status,
    provider: "fake-primary",
    model: "v1",
    traceId: `trace-${executionId}`,
    requestHash: "SECRET_REQUEST_HASH",
    policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
    budget: { maxLatencyMs: 1_000 },
    attempts: [
      {
        attemptNumber: 1,
        provider: "fake-primary",
        model: "v1",
        status: status === "succeeded" ? "succeeded" : "failed",
        startedAt: "2026-07-01T12:00:00.000Z",
        completedAt: "2026-07-01T12:00:00.010Z",
        durationMs: 10,
      },
    ],
    events: [],
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.010Z",
    durationMs: 10,
    outputText: "SECRET_OUTPUT",
    replayCapability: { state: "missing", available: false, reason: "not retained" },
    replayable: false,
  };
}

function comparison(): ComparisonExperiment {
  return {
    schemaVersion: 1,
    experimentId: "comparison-1",
    tenantId: "tenant-a",
    originalExecutionId: "original",
    variantExecutionId: "variant",
    status: "completed",
    requestedVariation: { provider: "fake-primary", reproducibilityCheck: true },
    resolvedVariant: {
      provider: "fake-primary",
      model: "v1",
      policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      budget: { maxLatencyMs: 1_000 },
      structuredOutputRequired: false,
    },
    createdAt: "2026-07-01T12:01:00.000Z",
    updatedAt: "2026-07-01T12:02:00.000Z",
  };
}

function caseRecord(overrides: Partial<InvestigationCase> = {}): InvestigationCase {
  return {
    schemaVersion: 1,
    caseId: "case-1",
    tenantId: "tenant-a",
    title: "Case",
    question: "Question?",
    status: "open",
    savedScope: { range: RANGE },
    createdAt: "2026-07-02T00:00:00.000Z",
    updatedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

function createdEvent(caseId: string): InvestigationCaseTimelineEvent {
  return {
    eventId: "event-created",
    caseId,
    type: "case.created",
    occurredAt: "2026-07-02T00:00:00.000Z",
    metadata: { status: "open" },
  };
}

function evidence(executionId: string): InvestigationCaseEvidence {
  return {
    evidenceId: "evidence-1",
    caseId: "case-1",
    type: "execution",
    executionId,
    addedAt: "2026-07-02T00:01:00.000Z",
    url: `/executions/${executionId}`,
  };
}

function evidenceEvent(caseId: string): InvestigationCaseTimelineEvent {
  return {
    eventId: "event-evidence",
    caseId,
    type: "case.evidence_added",
    occurredAt: "2026-07-02T00:01:00.000Z",
    metadata: { evidenceId: "evidence-1", evidenceType: "execution" },
  };
}
