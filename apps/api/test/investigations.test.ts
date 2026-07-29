import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExecutionService } from "@reliability-lab/core";
import type { buildApp } from "../src/app.js";
import { buildTestApp } from "./support/build-test-app.js";

describe("API investigations", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let service: ExecutionService;

  beforeEach(async () => {
    ({ app, service } = await buildTestApp());
  });

  afterEach(async () => app.close());

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
});
