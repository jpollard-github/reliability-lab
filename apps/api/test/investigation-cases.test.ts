import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeCaseCursor, type ExecutionService } from "@reliability-lab/core";
import type { buildApp } from "../src/app.js";
import { buildTestApp } from "./support/build-test-app.js";

describe("API saved investigation cases", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    ({ app, service } = await buildTestApp());
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
});
