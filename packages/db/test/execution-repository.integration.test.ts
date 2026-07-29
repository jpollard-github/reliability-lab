import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import { PostgresExecutionRepository } from "../src/index.js";
import { useIntegrationDatabase } from "./support/database.js";

describe("Postgres execution repository", () => {
  const connection = useIntegrationDatabase();

  it("persists tenant-isolated envelopes, attempts, events, and idempotency", async () => {
    if (!connection) return;
    const tenantId = `integration-${randomUUID()}`;
    const repository = new PostgresExecutionRepository(connection.db);
    const service = new ExecutionService({
      repository,
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
    const afterTwo = await repository.eventsAfter(tenantId, first.executionId, 2);
    expect(afterTwo?.every((event) => event.sequence > 2)).toBe(true);
    expect(afterTwo?.map((event) => event.sequence)).toEqual(
      [...(afterTwo ?? [])].map((event) => event.sequence).sort((left, right) => left - right),
    );
    expect(await repository.eventsAfter("different-tenant", first.executionId, 0)).toBeNull();
    expect(await service.list("different-tenant")).toEqual([]);
  });
});
