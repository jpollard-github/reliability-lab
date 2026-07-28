import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  encodeCaseCursor,
  ExecutionService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryComparisonExperimentRepository,
  MemoryExecutionRepository,
  MemoryInvestigationCaseRepository,
  MemoryInvestigationReadRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import { buildApp } from "../src/app.js";

describe("Reliability Lab API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    const repository = new MemoryExecutionRepository();
    const comparisons = new MemoryComparisonExperimentRepository();
    service = new ExecutionService({
      repository,
      comparisons,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([
        new DeterministicFakeProvider({ id: "fake-primary" }),
        new DeterministicFakeProvider({ id: "fake-fallback" }),
      ]),
    });
    app = await buildApp({
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
  });

  afterEach(async () => app.close());

  it("publishes health, readiness, and OpenAPI documents", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    const openapi = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths["/v1/executions"]).toBeDefined();
    expect(openapi.json().paths["/v1/executions/{executionId}/events"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/executions"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/summary"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigations/providers"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases/{caseId}"]).toBeDefined();
    expect(openapi.json().paths["/v1/investigation-cases/{caseId}/notes"]).toBeDefined();
  });

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

  it("serves tenant-scoped compact investigation projections", async () => {
    const execution = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "deterministic-v1",
        input: "Investigation fixture",
      },
    });
    await service.execute({
      tenantId: "tenant-b",
      body: {
        provider: "fake-primary",
        model: "deterministic-v1",
        input: "Other tenant",
      },
    });
    const list = await app.inject({
      method: "GET",
      url: `/v1/investigations/executions?q=${execution.executionId.slice(0, 12)}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      total: 1,
      data: [
        {
          executionId: execution.executionId,
          status: "succeeded",
          initialProvider: "fake-primary",
          attemptCount: 1,
        },
      ],
    });
    expect(list.body).not.toContain("Investigation fixture");
    expect(list.body).not.toContain("outputText");
    const resolvedRange = list.json().range as { from: string; to: string };
    expect(Date.parse(resolvedRange.to) - Date.parse(resolvedRange.from)).toBe(86_400_000);

    const failedExecution = await service.execute({
      tenantId: "tenant-a",
      body: {
        provider: "fake-primary",
        model: "deterministic-v1",
        input: "Failed investigation fixture",
        failureMode: "provider_error",
        policy: { maxAttempts: 1 },
      },
    });
    expect(failedExecution.status).toBe("failed");
    const filterFrom = encodeURIComponent(new Date(Date.now() - 60_000).toISOString());
    const filterTo = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    const multiFilter = await app.inject({
      method: "GET",
      url:
        `/v1/investigations/executions?from=${filterFrom}&to=${filterTo}` +
        "&status=succeeded&status=failed&provider=fake-primary",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(multiFilter.statusCode).toBe(200);
    expect(multiFilter.json().total).toBe(2);

    const summary = await app.inject({
      method: "GET",
      url: `/v1/investigations/summary?from=${filterFrom}&to=${filterTo}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().population).toMatchObject({ total: 2, terminal: 2 });
    expect(summary.json().outcomes.successRate).toBe(0.5);
    expect(summary.json().signals.providerUnavailableFailures).toBe(1);
    expect(summary.body).not.toContain("providerCapacityFailures");

    const providers = await app.inject({
      method: "GET",
      url: `/v1/investigations/providers?from=${filterFrom}&to=${filterTo}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(providers.statusCode).toBe(200);
    expect(providers.json().data[0]).toMatchObject({
      provider: "fake-primary",
      attemptCount: 2,
      sampleAssessment: "insufficient_sample",
    });

    const empty = await app.inject({
      method: "GET",
      url: "/v1/investigations/executions?from=2030-01-01T00%3A00%3A00.000Z&to=2030-01-02T00%3A00%3A00.000Z",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toMatchObject({ data: [], total: 0 });
  });

  it("validates investigation ranges, limits, and cursors", async () => {
    const missingRangePair = await app.inject({
      method: "GET",
      url: "/v1/investigations/summary?from=2026-01-01T00%3A00%3A00.000Z",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(missingRangePair.statusCode).toBe(400);

    const tooWide = await app.inject({
      method: "GET",
      url: "/v1/investigations/summary?from=2025-01-01T00%3A00%3A00.000Z&to=2026-01-01T00%3A00%3A00.000Z",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(tooWide.statusCode).toBe(400);

    const malformedCursor = await app.inject({
      method: "GET",
      url: "/v1/investigations/executions?cursor=not-opaque",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(malformedCursor.statusCode).toBe(400);

    const oversizedPage = await app.inject({
      method: "GET",
      url: "/v1/investigations/executions?limit=101",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(oversizedPage.statusCode).toBe(400);
  });

  it("validates tenant and request body", async () => {
    const missingTenant = await app.inject({
      method: "POST",
      url: "/v1/executions",
      payload: { provider: "fake-primary", model: "v1", input: "test" },
    });
    expect(missingTenant.statusCode).toBe(400);

    const unknownField = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: { provider: "fake-primary", model: "v1", input: "test", secret: "not accepted" },
    });
    expect(unknownField.statusCode).toBe(400);
  });

  it("creates, lists, reads, and replays an execution", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a", "idempotency-key": "api-test" },
      payload: { provider: "fake-primary", model: "v1", input: "test" },
    });
    expect(create.statusCode).toBe(202);
    const executionId = create.json().executionId as string;
    expect(create.json().status).toBe("running");

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a", "idempotency-key": "api-test" },
      payload: { provider: "fake-primary", model: "v1", input: "test" },
    });
    expect(duplicate.json().executionId).toBe(executionId);

    await waitForTerminal(service, "tenant-a", executionId);
    const list = await app.inject({
      method: "GET",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(list.json().count).toBe(1);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().tenantId).toBe("tenant-a");
    expect(detail.json().policy).toMatchObject({ maxAttempts: 2, maxBackoffMs: 1_000 });
    expect(detail.json().budget).toMatchObject({ maxLatencyMs: 10_000 });
    expect(detail.json().replayCapability.state).toBe("available");

    const replay = await app.inject({
      method: "POST",
      url: `/v1/executions/${executionId}/replay`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(replay.statusCode).toBe(202);
    expect(replay.json().replayExecution.replayOfExecutionId).toBe(executionId);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/executions/${executionId}/replay-capsule`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      executionId,
      deleted: true,
      replayCapability: { state: "deleted", available: false },
    });
    const deletedAgain = await app.inject({
      method: "DELETE",
      url: `/v1/executions/${executionId}/replay-capsule`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(deletedAgain.json().deleted).toBe(false);
    const replayAfterDelete = await app.inject({
      method: "POST",
      url: `/v1/executions/${executionId}/replay`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(replayAfterDelete.statusCode).toBe(409);
    expect(replayAfterDelete.json().capability.state).toBe("deleted");
  });

  it("creates and reads tenant-scoped comparative replays without accepting prompt changes", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "comparison input must stay retained",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const originalExecutionId = create.json().executionId as string;
    await waitForTerminal(service, "tenant-a", originalExecutionId);

    const promptReplacement = await app.inject({
      method: "POST",
      url: `/v1/executions/${originalExecutionId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { variation: { input: "replacement is forbidden", policy: { maxAttempts: 1 } } },
    });
    expect(promptReplacement.statusCode).toBe(400);

    const comparison = await app.inject({
      method: "POST",
      url: `/v1/executions/${originalExecutionId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        variation: {
          policy: {
            maxAttempts: 1,
            fallbackProvider: "fake-fallback",
            fallbackModel: "fallback-v1",
          },
        },
      },
    });
    expect(comparison.statusCode).toBe(202);
    expect(comparison.json().experiment).toMatchObject({
      status: "running",
      originalExecutionId,
      resolvedVariant: { policy: { maxAttempts: 1 } },
    });
    expect(comparison.body).not.toContain("comparison input must stay retained");
    const experimentId = comparison.json().experiment.experimentId as string;
    const variantExecutionId = comparison.json().experiment.variantExecutionId as string;
    await waitForTerminal(service, "tenant-a", variantExecutionId);

    const view = await app.inject({
      method: "GET",
      url: `/v1/comparisons/${experimentId}`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(view.statusCode).toBe(200);
    expect(view.json()).toMatchObject({
      experiment: { status: "completed", originalExecutionId, variantExecutionId },
      originalExecution: { executionId: originalExecutionId },
      variantExecution: {
        executionId: variantExecutionId,
        replayOfExecutionId: originalExecutionId,
      },
      projection: { schemaVersion: 1 },
    });
    expect(view.body).not.toContain("comparison input must stay retained");

    const crossTenant = await app.inject({
      method: "GET",
      url: `/v1/comparisons/${experimentId}`,
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(crossTenant.statusCode).toBe(404);
  });

  it("backfills events in order, closes after terminal state, and honors a cursor", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: {
        "x-tenant-id": "tenant-a",
        "idempotency-key": "stream-terminal-cursor",
      },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "stream evidence",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const executionId = create.json().executionId as string;
    await waitForTerminal(service, "tenant-a", executionId);

    const stream = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events`,
      headers: {
        "x-tenant-id": "tenant-a",
        origin: "http://127.0.0.1:3000",
      },
    });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
    const events = sseEvents(stream.body);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.at(-1)?.type).toBe("execution.succeeded");

    const resumed = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=4`,
      headers: { "x-tenant-id": "tenant-a", "last-event-id": "2" },
    });
    expect(sseEvents(resumed.body).map((event) => event.sequence)).toEqual([5, 6, 7]);

    const caughtUp = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=7`,
      headers: { "x-tenant-id": "tenant-a", "last-event-id": "7" },
    });
    expect(caughtUp.body).toContain("event: complete");
    expect(caughtUp.body).toContain('"status":"succeeded"');

    await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: {
        "x-tenant-id": "tenant-a",
        "idempotency-key": "stream-terminal-cursor",
      },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "stream evidence",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const afterTerminalMetadata = await app.inject({
      method: "GET",
      url: `/v1/executions/${executionId}/events?after=7`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(afterTerminalMetadata.body).toContain("event: complete");
  });

  it("returns 202 while work is running and streams through terminal completion", async () => {
    let releaseProvider!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const provider: LlmProvider = {
      id: "gated",
      kind: "fake",
      execute: async (request) => {
        await gate;
        return {
          ok: true,
          response: {
            provider: "gated",
            model: request.model,
            outputText: "done",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const gatedRepository = new MemoryExecutionRepository();
    const gatedComparisons = new MemoryComparisonExperimentRepository();
    const gatedService = new ExecutionService({
      repository: gatedRepository,
      comparisons: gatedComparisons,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([provider]),
    });
    const gatedApp = await buildApp({
      service: gatedService,
      investigationCases: new InvestigationCaseService({
        cases: new MemoryInvestigationCaseRepository(),
        executions: gatedRepository,
        comparisons: gatedComparisons,
      }),
      investigations: new MemoryInvestigationReadRepository(gatedRepository),
      logger: false,
      enableFailureInjection: true,
      eventStreamPollMs: 1,
    });
    try {
      const create = await gatedApp.inject({
        method: "POST",
        url: "/v1/executions",
        headers: { "x-tenant-id": "tenant-a" },
        payload: { provider: "gated", model: "v1", input: "gated" },
      });
      expect(create.statusCode).toBe(202);
      expect(create.json().status).toBe("running");
      const executionId = create.json().executionId as string;

      const streamPromise = gatedApp.inject({
        method: "GET",
        url: `/v1/executions/${executionId}/events`,
        headers: { "x-tenant-id": "tenant-a" },
      });
      releaseProvider();
      const stream = await streamPromise;
      expect(sseEvents(stream.body).map((event) => event.type)).toEqual([
        "execution.accepted",
        "attempt.started",
        "provider.response_received",
        "execution.succeeded",
      ]);
    } finally {
      await gatedApp.close();
    }
  });

  it("rejects cross-tenant reads", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: { provider: "fake-primary", model: "v1", input: "test" },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/v1/executions/${create.json().executionId as string}`,
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(detail.statusCode).toBe(404);
    const deletion = await app.inject({
      method: "DELETE",
      url: `/v1/executions/${create.json().executionId as string}/replay-capsule`,
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(deletion.statusCode).toBe(404);
    const stream = await app.inject({
      method: "GET",
      url: `/v1/executions/${create.json().executionId as string}/events`,
      headers: { "x-tenant-id": "tenant-b" },
    });
    expect(stream.statusCode).toBe(404);
  });
});

async function waitForTerminal(service: ExecutionService, tenantId: string, executionId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const execution = await service.get(tenantId, executionId);
    if (["succeeded", "degraded", "failed", "cancelled"].includes(execution.status)) {
      return execution;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Execution did not reach a terminal state");
}

function sseEvents(body: string): Array<{ sequence: number; type: string }> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as { sequence: number; type: string });
}
