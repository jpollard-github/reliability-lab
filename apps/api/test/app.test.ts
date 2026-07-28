import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryExecutionRepository,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import { buildApp } from "../src/app.js";

describe("Reliability Lab API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    const service = new ExecutionService({
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

    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a", "idempotency-key": "api-test" },
      payload: { provider: "fake-primary", model: "v1", input: "test" },
    });
    expect(duplicate.json().executionId).toBe(executionId);

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
  });
});
