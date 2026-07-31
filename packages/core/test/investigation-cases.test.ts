import { describe, expect, it } from "vitest";
import type {
  ComparisonExperiment,
  ExecutionEnvelope,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";
import {
  canonicalizeSavedScope,
  InvestigationCaseInputError,
  InvestigationCaseNotFoundError,
  InvestigationCaseService,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  savedScopeFromWorkbenchState,
  savedScopeToWorkbenchUrl,
} from "../src/index.js";

const RANGE = {
  from: "2026-07-01T00:00:00.000Z",
  to: "2026-07-02T00:00:00.000Z",
};

function harness() {
  const cases = new MemoryInvestigationCaseRepository();
  const executions = new MemoryExecutionRepository();
  const comparisons = new MemoryComparisonExperimentRepository();
  let current = new Date("2026-07-02T12:00:00.000Z");
  let sequence = 0;
  const service = new InvestigationCaseService({
    cases,
    executions,
    comparisons,
    now: () => current,
    id: () => `id-${String(++sequence).padStart(4, "0")}`,
  });
  return {
    cases,
    executions,
    comparisons,
    service,
    advance(milliseconds = 1_000) {
      current = new Date(current.getTime() + milliseconds);
    },
  };
}

describe("saved investigation scopes", () => {
  it("resolves exact instants, omits presentation state, and canonicalizes arrays", () => {
    const scope = savedScopeFromWorkbenchState(
      {
        window: "24h",
        cursor: "discard-me",
        q: " trace-12 ",
        status: ["failed", "", "failed", "degraded"],
        provider: "zeta, alpha,zeta",
        model: ["v2", "v1"],
        signal: "retry_recovered",
      },
      RANGE,
    );
    expect(scope).toEqual({
      range: RANGE,
      query: "trace-12",
      statuses: ["degraded", "failed"],
      providers: ["alpha", "zeta"],
      models: ["v1", "v2"],
      signal: "retry_recovered",
    });
    expect(savedScopeToWorkbenchUrl(scope)).toBe(
      "/investigations?from=2026-07-01T00%3A00%3A00.000Z&to=2026-07-02T00%3A00%3A00.000Z&q=trace-12&status=degraded&status=failed&provider=alpha&provider=zeta&model=v1&model=v2&signal=retry_recovered#execution-explorer",
    );
  });

  it("requires a valid bounded exact range", () => {
    expect(() =>
      canonicalizeSavedScope({
        range: { from: RANGE.to, to: RANGE.from },
      }),
    ).toThrow(InvestigationCaseInputError);
  });
});

describe("InvestigationCaseService", () => {
  it("trims bounded text, preserves append-only notes, and records metadata-only events", async () => {
    const { service, advance } = harness();
    const created = await service.create("tenant-a", {
      title: "  Retry recovery  ",
      question: "  Are retries recovering?  ",
      importance: "notable",
      savedScope: { range: RANGE },
    });
    expect(created.case).toMatchObject({
      title: "Retry recovery",
      question: "Are retries recovering?",
      status: "open",
    });

    advance();
    await service.addNote("tenant-a", created.case.caseId, { body: "  First observation.  " });
    await service.addNote("tenant-a", created.case.caseId, { body: "Correction follows." });
    const detail = await service.get("tenant-a", created.case.caseId);
    expect(detail.notes.map((note) => note.body)).toEqual([
      "First observation.",
      "Correction follows.",
    ]);
    expect(JSON.stringify(detail.timeline)).not.toContain("First observation");
    expect(detail.timeline.map((event) => event.type)).toEqual([
      "case.created",
      "case.note_added",
      "case.note_added",
    ]);
  });

  it("updates interpretation and maintains coherent resolved timestamps", async () => {
    const { service, advance } = harness();
    const created = await service.create("tenant-a", baseCreate());
    advance();
    const resolved = await service.update("tenant-a", created.case.caseId, {
      status: "resolved",
      finding: "Retries recovered the selected runs.",
      resolution: "Keep the bounded retry policy.",
    });
    expect(resolved.case.resolvedAt).toBe(resolved.case.updatedAt);
    expect(resolved.timeline.map((event) => event.type)).toEqual([
      "case.created",
      "case.updated",
      "case.status_changed",
      "case.finding_updated",
      "case.resolution_updated",
    ]);
    expect(JSON.stringify(resolved.timeline)).not.toContain("Retries recovered");

    advance();
    const reopened = await service.update("tenant-a", created.case.caseId, {
      status: "investigating",
    });
    expect(reopened.case.resolvedAt).toBeUndefined();
  });

  it("requires finding and resolution for resolved state and permits clearing after reopen", async () => {
    const { service } = harness();
    const created = await service.create("tenant-a", baseCreate());
    await expect(
      service.update("tenant-a", created.case.caseId, { status: "resolved" }),
    ).rejects.toThrow("Resolved cases require a non-empty current finding and resolution");
    await expect(
      service.update("tenant-a", created.case.caseId, {
        status: "resolved",
        finding: "Evidence supports the current interpretation.",
      }),
    ).rejects.toThrow("Resolved cases require a non-empty current finding and resolution");
    const resolved = await service.update("tenant-a", created.case.caseId, {
      status: "resolved",
      finding: "Evidence supports the current interpretation.",
      resolution: "Retain the bounded policy.",
    });
    await expect(
      service.update("tenant-a", created.case.caseId, { finding: null }),
    ).rejects.toThrow("Resolved cases require a non-empty current finding and resolution");
    await expect(
      service.update("tenant-a", created.case.caseId, { resolution: null }),
    ).rejects.toThrow("Resolved cases require a non-empty current finding and resolution");
    const reopened = await service.update("tenant-a", resolved.case.caseId, {
      status: "investigating",
      finding: null,
      resolution: null,
    });
    expect(reopened.case).toMatchObject({ status: "investigating" });
    expect(reopened.case.finding).toBeUndefined();
    expect(reopened.case.resolution).toBeUndefined();
  });

  it("validates tenant-owned evidence and makes duplicate links idempotent", async () => {
    const { service, executions, comparisons } = harness();
    await executions.create(execution("tenant-a", "execution-a"));
    await comparisons.create(comparison("tenant-a", "comparison-a"));
    const created = await service.create("tenant-a", baseCreate());

    const first = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "execution",
      executionId: "execution-a",
    });
    const duplicate = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "execution",
      executionId: "execution-a",
    });
    expect(first.added).toBe(true);
    expect(duplicate).toEqual({ evidence: first.evidence, added: false });

    await service.addEvidence("tenant-a", created.case.caseId, {
      type: "comparison",
      experimentId: "comparison-a",
    });
    await service.addEvidence("tenant-a", created.case.caseId, {
      type: "provider_observation",
      provider: " fake-primary ",
      model: " v1 ",
      range: RANGE,
    });
    const detail = await service.get("tenant-a", created.case.caseId);
    expect(detail.evidence).toHaveLength(3);
    expect(detail.timeline.filter((event) => event.type === "case.evidence_added")).toHaveLength(3);

    await expect(
      service.addEvidence("tenant-a", created.case.caseId, {
        type: "execution",
        executionId: "other-tenant-execution",
      }),
    ).rejects.toBeInstanceOf(InvestigationCaseNotFoundError);
  });

  it("closes a recorded comparison-link failure when the comparison is already linked", async () => {
    const { service, comparisons } = harness();
    await comparisons.create(comparison("tenant-a", "comparison-a"));
    const created = await service.create("tenant-a", baseCreate());
    const linked = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "comparison",
      experimentId: "comparison-a",
    });
    await service.recordComparisonLinkFailure("tenant-a", created.case.caseId, {
      experimentId: "comparison-a",
      originalExecutionId: "execution-a",
    });

    const recovered = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "comparison",
      experimentId: "comparison-a",
    });
    const repeated = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "comparison",
      experimentId: "comparison-a",
    });
    const detail = await service.get("tenant-a", created.case.caseId);

    expect(recovered).toEqual({ evidence: linked.evidence, added: false });
    expect(repeated).toEqual({ evidence: linked.evidence, added: false });
    expect(detail.evidence).toHaveLength(1);
    expect(
      detail.timeline.filter((event) => event.type === "case.comparison_link_recovered"),
    ).toHaveLength(1);
  });

  it("removes only the association and leaves a lifecycle event", async () => {
    const { service, executions } = harness();
    await executions.create(execution("tenant-a", "execution-a"));
    const created = await service.create("tenant-a", baseCreate());
    const linked = await service.addEvidence("tenant-a", created.case.caseId, {
      type: "execution",
      executionId: "execution-a",
    });
    await service.removeEvidence("tenant-a", created.case.caseId, linked.evidence.evidenceId);
    const detail = await service.get("tenant-a", created.case.caseId);
    expect(detail.evidence).toEqual([]);
    expect(detail.timeline.at(-1)?.type).toBe("case.evidence_removed");
    expect(await executions.findById("tenant-a", "execution-a")).not.toBeNull();
  });

  it("returns stable pages and preserves total on an empty cursor page", async () => {
    const { service } = harness();
    const first = await service.create("tenant-a", {
      ...baseCreate(),
      title: "Case A",
    });
    const second = await service.create("tenant-a", {
      ...baseCreate(),
      title: "Case B",
    });
    const pageOne = await service.list("tenant-a", { limit: 1 });
    const pageTwo = await service.list("tenant-a", {
      limit: 1,
      ...(pageOne.nextCursor ? { cursor: pageOne.nextCursor } : {}),
    });
    const terminal = await service.list("tenant-a", {
      limit: 1,
      cursor: Buffer.from(
        JSON.stringify({
          v: 1,
          updatedAt: [first, second].map((item) => item.case.updatedAt).sort()[0],
          caseId: "0000",
        }),
      ).toString("base64url"),
    });
    expect(pageOne.data[0]?.case.caseId).not.toBe(pageTwo.data[0]?.case.caseId);
    expect(terminal).toMatchObject({ data: [], total: 2 });
  });

  it("rejects HTML and hides cross-tenant cases as not found", async () => {
    const { service } = harness();
    await expect(
      service.create("tenant-a", { ...baseCreate(), title: "<b>unsafe</b>" }),
    ).rejects.toBeInstanceOf(InvestigationCaseInputError);
    const created = await service.create("tenant-a", baseCreate());
    await expect(service.get("tenant-b", created.case.caseId)).rejects.toBeInstanceOf(
      InvestigationCaseNotFoundError,
    );
  });
});

function baseCreate() {
  return {
    title: "Retry recovery",
    question: "Are retries recovering?",
    savedScope: { range: RANGE } satisfies SavedInvestigationScope,
  };
}

function execution(tenantId: string, executionId: string): ExecutionEnvelope {
  const now = "2026-07-01T12:00:00.000Z";
  return {
    schemaVersion: 1,
    executionId,
    tenantId,
    status: "succeeded",
    provider: "fake-primary",
    model: "v1",
    traceId: `trace-${executionId}`,
    requestHash: "hash",
    policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
    budget: { maxLatencyMs: 1_000 },
    attempts: [],
    events: [],
    createdAt: now,
    updatedAt: now,
    replayCapability: { state: "missing", available: false, reason: "not retained" },
    replayable: false,
  };
}

function comparison(tenantId: string, experimentId: string): ComparisonExperiment {
  const now = "2026-07-01T12:00:00.000Z";
  return {
    schemaVersion: 1,
    experimentId,
    tenantId,
    originalExecutionId: "execution-a",
    status: "completed",
    requestedVariation: {},
    resolvedVariant: {
      provider: "fake-primary",
      model: "v1",
      policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      budget: { maxLatencyMs: 1_000 },
      structuredOutputRequired: false,
    },
    createdAt: now,
    updatedAt: now,
  };
}
