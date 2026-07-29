import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionService } from "@reliability-lab/core";
import type { buildApp } from "../src/app.js";
import { buildTestApp, waitForTerminal } from "./support/build-test-app.js";

describe("API comparative replay", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    ({ app, service } = await buildTestApp());
  });

  afterEach(async () => app.close());

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
});
