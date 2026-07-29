import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  encodeExecutionCursor,
  ExecutionService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import { PostgresExecutionRepository, PostgresInvestigationReadRepository } from "../src/index.js";
import { useIntegrationDatabase } from "./support/database.js";

describe("Postgres investigation read repository", () => {
  const connection = useIntegrationDatabase();

  it("serves bounded investigation projections with a fixed query count", async () => {
    if (!connection) return;
    const tenantId = `investigation-${randomUUID()}`;
    const repository = new PostgresExecutionRepository(connection.db);
    const service = new ExecutionService({
      repository,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([
        new DeterministicFakeProvider({ id: "fake-primary" }),
        new DeterministicFakeProvider({ id: "fake-fallback" }),
      ]),
    });
    const retry = await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "investigation retry",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const fallback = await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "investigation fallback",
        failureMode: "provider_error",
        policy: {
          maxAttempts: 1,
          fallbackProvider: "fake-fallback",
          fallbackModel: "fallback-v1",
        },
      },
    });
    const structuredRejection = await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "investigation structured rejection",
        failureMode: "malformed_json",
        structuredOutputSchema: {
          type: "object",
          required: ["result"],
          properties: { result: { type: "string" } },
        },
        policy: { maxAttempts: 1 },
      },
    });
    await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "investigation latency budget",
        failureMode: "latency",
        budget: { maxLatencyMs: 1 },
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    await service.execute({
      tenantId: `${tenantId}-other`,
      body: { provider: "fake-primary", model: "v1", input: "tenant isolation" },
    });
    const operations: string[] = [];
    const investigations = new PostgresInvestigationReadRepository(connection.db, {
      onQuery: (operation) => operations.push(operation),
    });
    const range = {
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString(),
    };
    const page = await investigations.searchExecutions(tenantId, {
      range,
      limit: 1,
      query: retry.executionId.slice(0, 12),
      signal: "retry_recovered",
    });
    expect(page).toMatchObject({
      total: 1,
      data: [
        {
          executionId: retry.executionId,
          attemptCount: 2,
          retryCount: 1,
          signals: ["retry_recovered"],
        },
      ],
    });
    const fallbackPage = await investigations.searchExecutions(tenantId, {
      range,
      limit: 25,
      providers: ["fake-fallback"],
      models: ["v1"],
      signal: "fallback_used",
    });
    expect(fallbackPage.data.map((item) => item.executionId)).toEqual([fallback.executionId]);
    const rejectionPage = await investigations.searchExecutions(tenantId, {
      range,
      limit: 25,
      query: structuredRejection.traceId,
      statuses: ["failed", "degraded"],
      errorCategory: "malformed_response",
      errorCode: structuredRejection.error!.code,
      signal: "structured_output_rejected",
    });
    expect(rejectionPage.data.map((item) => item.executionId)).toEqual([
      structuredRejection.executionId,
    ]);
    const sharedCreatedAt = new Date();
    await connection.db.execute(
      sql`UPDATE executions SET created_at = ${sharedCreatedAt} WHERE tenant_id = ${tenantId}`,
    );
    const traversed: string[] = [];
    let cursor: string | undefined;
    let lastRow: { createdAt: string; executionId: string } | undefined;
    do {
      const cursorPage = await investigations.searchExecutions(tenantId, {
        range,
        limit: 1,
        ...(cursor ? { cursor } : {}),
      });
      if (cursorPage.data[0]) {
        traversed.push(cursorPage.data[0].executionId);
        lastRow = cursorPage.data[0];
      }
      cursor = cursorPage.nextCursor;
    } while (cursor);
    expect(new Set(traversed).size).toBe(4);
    expect(lastRow).toBeDefined();
    const emptyTerminalPage = await investigations.searchExecutions(tenantId, {
      range,
      limit: 1,
      cursor: encodeExecutionCursor(lastRow!.createdAt, lastRow!.executionId),
    });
    expect(emptyTerminalPage).toMatchObject({ data: [], total: 4 });
    const [summary, providerPage] = await Promise.all([
      investigations.summarize(tenantId, range),
      investigations.observeProviders(tenantId, { range, limit: 50 }),
    ]);
    expect(summary.population).toMatchObject({ total: 4, terminal: 4 });
    expect(summary.signals.retryRecovered).toBe(2);
    expect(summary.signals).toMatchObject({
      fallbackUsed: 1,
      structuredOutputRejected: 1,
      latencyBudgetExceeded: 1,
      rateLimitFailures: 1,
      providerUnavailableFailures: 1,
    });
    expect(summary.latency.sampleSize).toBe(4);
    expect(providerPage.data.find((item) => item.provider === "fake-primary")).toMatchObject({
      provider: "fake-primary",
      attemptCount: 5,
      rateLimitedAttempts: 1,
      sampleAssessment: "observed",
    });
    expect(providerPage.data.find((item) => item.provider === "fake-fallback")).toMatchObject({
      model: "v1",
      attemptCount: 1,
      fallbackSelectedToRoute: 0,
      sampleAssessment: "insufficient_sample",
    });
    expect(operations.filter((operation) => operation === "search")).toHaveLength(8);
    expect(operations.filter((operation) => operation === "search_count")).toHaveLength(8);
    expect(operations.slice(-3)).toEqual(["summary", "trend", "providers"]);
  });
});
