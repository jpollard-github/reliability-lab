import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import { buildApp } from "../src/app.js";

describe("Reliability Lab API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    service = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([
        new DeterministicFakeProvider({ id: "fake-primary" }),
        new DeterministicFakeProvider({ id: "fake-fallback" }),
      ]),
    });
    app = await buildApp({ service, logger: false, enableFailureInjection: true });
  });

  afterEach(async () => app.close());

  it("publishes health, readiness, and OpenAPI documents", async () => {
    expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
    const openapi = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(openapi.statusCode).toBe(200);
    expect(openapi.json().paths["/v1/executions"]).toBeDefined();
    expect(openapi.json().paths["/v1/executions/{executionId}/events"]).toBeDefined();
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
    const gatedService = new ExecutionService({
      repository: new MemoryExecutionRepository(),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([provider]),
    });
    const gatedApp = await buildApp({
      service: gatedService,
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
