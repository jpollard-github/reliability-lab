import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionService } from "@reliability-lab/core";
import type { ProviderCapability } from "@reliability-lab/contracts";
import type { LlmProvider } from "@reliability-lab/providers";
import type { buildApp } from "../src/app.js";
import { buildTestApp, waitForTerminal } from "./support/build-test-app.js";

describe("API executions and replay", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    ({ app, service } = await buildTestApp());
  });

  afterEach(async () => app.close());

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

    const invalidRetentionIntent = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        provider: "fake-primary",
        model: "v1",
        input: "test",
        replayRetention: "browser-selected-store",
      },
    });
    expect(invalidRetentionIntent.statusCode).toBe(400);
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

  it("requires explicit live opt-in, retains children, constrains variants, and disables effects after delete", async () => {
    await app.close();
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "test-live",
      kind: "live",
      execute: async (request) => {
        providerCalls += 1;
        return {
          ok: true,
          response: {
            provider: "test-live",
            model: request.model,
            outputText: "safe live result",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const liveCapability: ProviderCapability = {
      id: "test-live",
      kind: "live",
      modelLabel: "fixed-model",
      transportFamily: "openai_compatible_chat_completions",
      configured: true,
      supportsFailureInjection: false,
      operatorEligible: true,
    };
    ({ app, service } = await buildTestApp({
      allowLivePromptRetention: true,
      providerRuntime: { providers: [liveProvider], capabilities: [liveCapability] },
    }));

    const unretainedResponse = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: { provider: "test-live", model: "fixed-model", input: "not retained" },
    });
    const unretained = await waitForTerminal(
      service,
      "tenant-a",
      unretainedResponse.json().executionId as string,
    );
    expect(unretained.replayCapability.state).toBe("retention_disabled");

    const retainedResponse = await app.inject({
      method: "POST",
      url: "/v1/executions",
      headers: { "x-tenant-id": "tenant-a" },
      payload: {
        provider: "test-live",
        model: "fixed-model",
        input: "retained but never returned by control routes",
        replayRetention: "encrypted",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const originalId = retainedResponse.json().executionId as string;
    const original = await waitForTerminal(service, "tenant-a", originalId);
    expect(original.replayCapability.state).toBe("available");

    const replayResponse = await app.inject({
      method: "POST",
      url: `/v1/executions/${originalId}/replay`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(replayResponse.statusCode).toBe(202);
    expect(replayResponse.json().replayExecution).toMatchObject({
      replayOfExecutionId: originalId,
      replayCapability: { state: "available" },
    });

    const comparisonResponse = await app.inject({
      method: "POST",
      url: `/v1/executions/${originalId}/comparisons`,
      headers: { "x-tenant-id": "tenant-a" },
      payload: { variation: { policy: { maxAttempts: 1 } } },
    });
    expect(comparisonResponse.statusCode).toBe(202);
    const variantId = comparisonResponse.json().experiment.variantExecutionId as string;
    expect((await waitForTerminal(service, "tenant-a", variantId)).replayCapability.state).toBe(
      "available",
    );

    for (const variation of [{ provider: "fake-primary" }, { model: "browser-model" }]) {
      const rejected = await app.inject({
        method: "POST",
        url: `/v1/executions/${originalId}/comparisons`,
        headers: { "x-tenant-id": "tenant-a" },
        payload: { variation },
      });
      expect(rejected.statusCode).toBe(400);
    }
    expect(providerCalls).toBe(4);
    expect((await service.get("tenant-a", originalId)).policy.maxAttempts).toBe(2);

    await app.inject({
      method: "DELETE",
      url: `/v1/executions/${originalId}/replay-capsule`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    const blockedReplay = await app.inject({
      method: "POST",
      url: `/v1/executions/${originalId}/replay`,
      headers: { "x-tenant-id": "tenant-a" },
    });
    expect(blockedReplay.statusCode).toBe(409);
    expect(providerCalls).toBe(4);
  });
});
