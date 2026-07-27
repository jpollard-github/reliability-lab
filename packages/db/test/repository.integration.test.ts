import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import { createDatabase, PostgresExecutionRepository } from "../src/index.js";

describe("PostgresExecutionRepository", () => {
  const databaseUrl = process.env.DATABASE_URL;
  const connection = databaseUrl ? createDatabase(databaseUrl) : null;

  beforeAll(async () => {
    if (!connection) {
      throw new Error(
        "DATABASE_URL is required. Run `pnpm dev:infra` and `pnpm db:migrate` before integration tests.",
      );
    }
    await connection.db.execute(sql`select 1`);
  });

  afterAll(async () => {
    if (connection) await connection.pool.end();
  });

  it("persists tenant-isolated envelopes, attempts, events, and idempotency", async () => {
    if (!connection) return;
    const tenantId = `integration-${randomUUID()}`;
    const service = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([new DeterministicFakeProvider({ id: "fake-primary" })]),
    });
    const first = await service.execute({
      tenantId,
      idempotencyKey: "same",
      body: { provider: "fake-primary", model: "v1", input: "integration" },
    });
    const second = await service.execute({
      tenantId,
      idempotencyKey: "same",
      body: { provider: "fake-primary", model: "v1", input: "integration" },
    });
    expect(second.executionId).toBe(first.executionId);
    const stored = await service.get(tenantId, first.executionId);
    expect(stored.attempts).toHaveLength(1);
    expect(stored.events.at(-1)?.type).toBe("idempotency.hit");
    expect(await service.list("different-tenant")).toEqual([]);
  });
});
