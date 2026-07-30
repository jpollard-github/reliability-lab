import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeCaseCursor,
  type ExecutionService,
  type MemoryInvestigationCaseRepository,
} from "@reliability-lab/core";
import type { buildApp } from "../src/app.js";
import { buildTestApp } from "./support/build-test-app.js";

describe("API saved investigation cases", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;
  let cases: MemoryInvestigationCaseRepository;

  beforeEach(async () => {
    ({ app, service, cases } = await buildTestApp());
  });

  afterEach(async () => app.close());

  it("creates, updates, and reopens a safe tenant-scoped investigation case", async () => {
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "case evidence must not be copied",
      },
    });
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const create = await app.inject({
      method: "POST",
      url: "/v1/investigation-cases",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: " Retry recovery ",
        question: " Did the retry policy recover? ",
        importance: "notable",
        savedScope: {
          range: { from, to },
          providers: ["fake-primary", "fake-primary"],
          statuses: ["succeeded"],
          signal: "retry_recovered",
        },
      },
    });
    expect(create.statusCode).toBe(201);
    const caseId = create.json().case.caseId as string;
    expect(create.json()).toMatchObject({
      case: {
        title: "Retry recovery",
        question: "Did the retry policy recover?",
        savedScope: {
          range: { from, to },
          providers: ["fake-primary"],
        },
      },
    });

    const firstLink = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${caseId}/evidence`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { type: "execution", executionId: execution.executionId },
    });
    const duplicateLink = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${caseId}/evidence`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { type: "execution", executionId: execution.executionId },
    });
    expect(firstLink).toMatchObject({ statusCode: 200 });
    expect(firstLink.json().added).toBe(true);
    expect(duplicateLink.json()).toMatchObject({
      added: false,
      evidence: { evidenceId: firstLink.json().evidence.evidenceId },
    });

    const note = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${caseId}/notes`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { body: " The retry succeeded on the second attempt. " },
    });
    expect(note.statusCode).toBe(201);
    expect(note.json().body).toBe("The retry succeeded on the second attempt.");

    const update = await app.inject({
      method: "PATCH",
      url: `/v1/investigation-cases/${caseId}`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        status: "resolved",
        finding: "Retry recovered the selected execution.",
        resolution: "Keep the bounded retry.",
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().case).toMatchObject({ status: "resolved" });
    expect(update.json().case.resolvedAt).toBeDefined();
    expect(update.body).not.toContain("case evidence must not be copied");
    expect(JSON.stringify(update.json().timeline)).not.toContain(
      "Retry recovered the selected execution.",
    );
    expect(JSON.stringify(update.json())).not.toContain("actor");

    const list = await app.inject({
      method: "GET",
      url: "/v1/investigation-cases?status=resolved&q=retry&limit=1",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      total: 1,
      data: [{ case: { caseId }, evidenceCounts: { executions: 1 } }],
    });

    const secondCreate = await app.inject({
      method: "POST",
      url: "/v1/investigation-cases",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: "Fallback follow-up",
        question: "Did fallback change the terminal outcome?",
        savedScope: { range: { from, to }, signal: "fallback_used" },
      },
    });
    expect(secondCreate.statusCode).toBe(201);
    const firstCasePage = await app.inject({
      method: "GET",
      url: "/v1/investigation-cases?limit=1",
      headers: { "x-tenant-id": "tenant-a" },
    });
    const secondCasePage = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases?limit=1&cursor=${encodeURIComponent(firstCasePage.json().nextCursor)}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(firstCasePage.json().total).toBe(2);
    expect(secondCasePage.json()).toMatchObject({ total: 2, data: [{}] });
    const lastCase = secondCasePage.json().data[0].case as {
      caseId: string;
      updatedAt: string;
    };
    const terminalCasePage = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases?limit=1&cursor=${encodeURIComponent(
        encodeCaseCursor(lastCase.updatedAt, lastCase.caseId),
      )}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(terminalCasePage.json()).toMatchObject({ total: 2, data: [] });

    const otherTenant = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases/${caseId}`,
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(otherTenant.statusCode).toBe(404);
  });

  it("rejects moving case scopes, HTML, bounds, and cross-tenant evidence", async () => {
    const invalidScope = await app.inject({
      method: "POST",
      url: "/v1/investigation-cases",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: "Moving scope",
        question: "Should this be rejected?",
        savedScope: { window: "24h" },
      },
    });
    expect(invalidScope.statusCode).toBe(400);
    const html = await app.inject({
      method: "POST",
      url: "/v1/investigation-cases",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: "<b>unsafe</b>",
        question: "Plain text only",
        savedScope: {
          range: {
            from: new Date(Date.now() - 60_000).toISOString(),
            to: new Date().toISOString(),
          },
        },
      },
    });
    expect(html.statusCode).toBe(400);
  });

  it("returns bounded review JSON, explicit unavailable evidence, and a safe Markdown packet", async () => {
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "SECRET_PROMPT_INPUT",
      },
    });
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    const create = await app.inject({
      method: "POST",
      url: "/v1/investigation-cases",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        title: "Packet review",
        question: "Does the bounded evidence support the conclusion?",
        savedScope: { range: { from, to } },
      },
    });
    const caseId = create.json().case.caseId as string;
    await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${caseId}/evidence`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { type: "execution", executionId: execution.executionId },
    });
    await cases.addEvidence(
      "tenant-a",
      {
        evidenceId: "missing-evidence",
        caseId,
        type: "execution",
        executionId: "missing-execution",
        addedAt: new Date().toISOString(),
        url: "/executions/missing-execution",
      },
      "execution:missing-execution",
      [
        {
          eventId: "missing-evidence-event",
          caseId,
          type: "case.evidence_added",
          occurredAt: new Date().toISOString(),
          metadata: { evidenceId: "missing-evidence", evidenceType: "execution" },
        },
      ],
    );
    await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${caseId}/notes`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { body: "SECRET_NOTE_BODY" },
    });

    const incomplete = await app.inject({
      method: "PATCH",
      url: `/v1/investigation-cases/${caseId}`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { status: "resolved" },
    });
    expect(incomplete.statusCode).toBe(400);
    expect(incomplete.json()).toMatchObject({
      error: "invalid_case_conclusion",
      message: "Resolved cases require a non-empty current finding and resolution",
    });

    const review = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases/${caseId}/review`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(review.statusCode).toBe(200);
    expect(review.json()).toMatchObject({
      case: { caseId, status: "open" },
      noteCount: 1,
      readiness: { ready: false },
      evidence: [
        {
          type: "execution",
          availability: "available",
          summary: { executionId: execution.executionId },
        },
        {
          type: "execution",
          availability: "unavailable",
          reason: "authoritative_evidence_not_found",
        },
      ],
    });
    expect(review.body).not.toContain("SECRET_PROMPT_INPUT");
    expect(review.body).not.toContain("SECRET_NOTE_BODY");

    const packet = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases/${caseId}/review-packet`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(packet.statusCode).toBe(200);
    expect(packet.headers["content-type"]).toContain("text/markdown");
    expect(packet.headers["content-disposition"]).toBe(
      `attachment; filename="reliability-case-${caseId}.md"`,
    );
    expect(packet.body).toMatch(/^# Reliability case: Packet review/u);
    expect(packet.body).toContain("authoritative\\_evidence\\_not\\_found");
    expect(packet.body).not.toContain("SECRET_PROMPT_INPUT");
    expect(packet.body).not.toContain("SECRET_NOTE_BODY");

    for (const url of [
      `/v1/investigation-cases/${caseId}/review`,
      `/v1/investigation-cases/${caseId}/review-packet`,
    ]) {
      const wrongTenant = await app.inject({
        method: "GET",
        url,
        headers: { "x-tenant-id": "tenant-b" },
      });
      expect(wrongTenant.statusCode).toBe(404);
      expect(wrongTenant.json().error).toBe("not_found");
    }
  });

  it("creates a case comparison from linked execution evidence and returns safe links", async () => {
    const setup = await createCaseWithExecution(app, service);

    const response = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${setup.caseId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        executionEvidenceId: setup.evidenceId,
        variation: { reproducibilityCheck: true },
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      result: {
        kind: "comparison_linked",
        experiment: { originalExecutionId: setup.executionId },
      },
      links: {
        case: `/v1/investigation-cases/${setup.caseId}`,
        originalExecution: `/v1/executions/${setup.executionId}`,
      },
    });
    const experimentId = response.json().result.experiment.experimentId as string;
    expect(response.json().links.comparison).toBe(`/v1/comparisons/${experimentId}`);
    expect(response.body).not.toContain("SECRET_CASE_EXPERIMENT_INPUT");
    const detail = await app.inject({
      method: "GET",
      url: `/v1/investigation-cases/${setup.caseId}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(detail.json().evidence).toContainEqual(
      expect.objectContaining({ type: "comparison", experimentId }),
    );
    expect(detail.json().timeline).toContainEqual(
      expect.objectContaining({ type: "case.comparison_started" }),
    );
  });

  it("rejects invalid case experiment evidence and preserves tenant-safe not found behavior", async () => {
    const setup = await createCaseWithExecution(app, service);
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${setup.caseId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        executionEvidenceId: "not-linked-here",
        variation: { reproducibilityCheck: true },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toBe("invalid_investigation_case");

    const wrongTenant = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${setup.caseId}/comparisons`,
      headers: { "x-tenant-id": "tenant-b" },
      payload: {
        executionEvidenceId: setup.evidenceId,
        variation: { reproducibilityCheck: true },
      },
    });
    expect(wrongTenant.statusCode).toBe(404);
    expect(wrongTenant.json().error).toBe("not_found");
  });

  it("links an unavailable experiment and returns a recoverable partial link state", async () => {
    const unavailable = await createCaseWithExecution(app, service);
    await service.deleteReplayCapsule("tenant-a", unavailable.executionId);
    const unavailableResponse = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${unavailable.caseId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        executionEvidenceId: unavailable.evidenceId,
        variation: { reproducibilityCheck: true },
      },
    });
    expect(unavailableResponse.statusCode).toBe(409);
    expect(unavailableResponse.json()).toMatchObject({
      result: {
        kind: "comparison_linked",
        experiment: { status: "unavailable" },
      },
    });

    await app.close();
    ({ app, service, cases } = await buildTestApp({ failNextCaseComparisonLink: true }));
    const partial = await createCaseWithExecution(app, service);
    const partialResponse = await app.inject({
      method: "POST",
      url: `/v1/investigation-cases/${partial.caseId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        executionEvidenceId: partial.evidenceId,
        variation: { reproducibilityCheck: true },
      },
    });
    expect(partialResponse.statusCode).toBe(202);
    expect(partialResponse.json()).toMatchObject({
      result: {
        kind: "comparison_created_link_failed",
        recovery: { kind: "link_existing_comparison" },
      },
      links: {
        manualEvidenceLink: {
          method: "POST",
          body: { type: "comparison" },
        },
      },
    });
    const experimentId = partialResponse.json().result.experiment.experimentId as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/v1/comparisons/${experimentId}`,
          headers: { "x-tenant-id": "tenant-a" },
        })
      ).statusCode,
    ).toBe(200);
    const recovery = partialResponse.json().links.manualEvidenceLink as {
      href: string;
      body: { type: "comparison"; experimentId: string };
    };
    const firstRecovery = await app.inject({
      method: "POST",
      url: recovery.href,
      headers: { "x-tenant-id": "tenant-a" },
      payload: recovery.body,
    });
    const repeatedRecovery = await app.inject({
      method: "POST",
      url: recovery.href,
      headers: { "x-tenant-id": "tenant-a" },
      payload: recovery.body,
    });
    expect(firstRecovery.json().added).toBe(true);
    expect(repeatedRecovery.json()).toMatchObject({
      added: false,
      evidence: { evidenceId: firstRecovery.json().evidence.evidenceId },
    });
  });
});

async function createCaseWithExecution(
  app: Awaited<ReturnType<typeof buildApp>>,
  service: ExecutionService,
) {
  const execution = await service.execute({
    tenantId: "tenant-a",
    body: {
      provider: "fake-primary",
      model: "deterministic-v1",
      input: "SECRET_CASE_EXPERIMENT_INPUT",
    },
  });
  const create = await app.inject({
    method: "POST",
    url: "/v1/investigation-cases",
    headers: { "x-tenant-id": "tenant-a" },
    payload: {
      title: "Case experiment API",
      question: "Can the linked execution run a controlled comparison?",
      savedScope: {
        range: {
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString(),
        },
      },
    },
  });
  const caseId = create.json().case.caseId as string;
  const link = await app.inject({
    method: "POST",
    url: `/v1/investigation-cases/${caseId}/evidence`,
    headers: { "x-tenant-id": "tenant-a" },
    payload: { type: "execution", executionId: execution.executionId },
  });
  return {
    caseId,
    executionId: execution.executionId,
    evidenceId: link.json().evidence.evidenceId as string,
  };
}
