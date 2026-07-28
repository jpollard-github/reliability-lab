import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  ExecutionService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import {
  createDatabase,
  PostgresExecutionRepository,
  PostgresReplayCapsuleStore,
  replayCapsuleAudits,
  replayCapsules,
} from "../src/index.js";

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

  it("encrypts durable capsules, survives service reconstruction, and rotates write keys", async () => {
    if (!connection) return;
    const tenantId = `vault-${randomUUID()}`;
    const prompt = `recognizable-secret-${randomUUID()}`;
    const v1 = Buffer.alloc(32, 1);
    const v2 = Buffer.alloc(32, 2);
    const repository = new PostgresExecutionRepository(connection.db);
    const providers = new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary" }),
    ]);
    const originalService = new ExecutionService({
      repository,
      replayCapsules: new PostgresReplayCapsuleStore(connection.db, {
        activeVersion: "v1",
        keys: new Map([["v1", v1]]),
      }),
      providers,
    });
    const original = await originalService.execute({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: prompt },
    });

    const [stored] = await connection.db
      .select()
      .from(replayCapsules)
      .where(
        and(
          eq(replayCapsules.tenantId, tenantId),
          eq(replayCapsules.executionId, original.executionId),
        ),
      );
    expect(stored?.keyVersion).toBe("v1");
    expect(
      Buffer.concat([
        stored?.ciphertext ?? Buffer.alloc(0),
        stored?.nonce ?? Buffer.alloc(0),
        stored?.authenticationTag ?? Buffer.alloc(0),
      ]).includes(Buffer.from(prompt)),
    ).toBe(false);

    const reconstructedService = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      replayCapsules: new PostgresReplayCapsuleStore(connection.db, {
        activeVersion: "v2",
        keys: new Map([
          ["v1", v1],
          ["v2", v2],
        ]),
      }),
      providers,
    });
    const replay = await reconstructedService.replay(tenantId, original.executionId);
    expect(replay.replayable).toBe(true);
    if (!replay.replayable) return;
    expect(replay.replayExecution.replayOfExecutionId).toBe(original.executionId);

    const [newCapsule] = await connection.db
      .select()
      .from(replayCapsules)
      .where(
        and(
          eq(replayCapsules.tenantId, tenantId),
          eq(replayCapsules.executionId, replay.replayExecution.executionId),
        ),
      );
    expect(newCapsule?.keyVersion).toBe("v2");
    const tamperedTag = Buffer.from(newCapsule?.authenticationTag ?? Buffer.alloc(16));
    tamperedTag[0] = (tamperedTag[0] ?? 0) ^ 1;
    await connection.db
      .update(replayCapsules)
      .set({ authenticationTag: tamperedTag })
      .where(
        and(
          eq(replayCapsules.tenantId, tenantId),
          eq(replayCapsules.executionId, replay.replayExecution.executionId),
        ),
      );
    const unreadable = await reconstructedService.replay(
      tenantId,
      replay.replayExecution.executionId,
    );
    expect(unreadable.replayable).toBe(false);
    if (!unreadable.replayable) expect(unreadable.capability.state).toBe("unreadable");
    expect(
      (await reconstructedService.get(tenantId, replay.replayExecution.executionId))
        .replayCapability.state,
    ).toBe("unreadable");

    const unavailableStore = new PostgresReplayCapsuleStore(connection.db, {
      activeVersion: "v2",
      keys: new Map([["v2", v2]]),
    });
    expect((await unavailableStore.inspect(tenantId, original.executionId)).state).toBe(
      "key_unavailable",
    );
    expect(
      (await unavailableStore.getForReplay("different-tenant", original.executionId)).available,
    ).toBe(false);
    expect((await unavailableStore.delete("different-tenant", original.executionId)).deleted).toBe(
      false,
    );

    const deletion = await reconstructedService.deleteReplayCapsule(tenantId, original.executionId);
    expect(deletion.deleted).toBe(true);
    expect((await reconstructedService.get(tenantId, original.executionId)).replayable).toBe(false);
    const audits = await connection.db
      .select()
      .from(replayCapsuleAudits)
      .where(
        and(
          eq(replayCapsuleAudits.tenantId, tenantId),
          eq(replayCapsuleAudits.executionId, original.executionId),
        ),
      );
    expect(
      audits.some((audit) => audit.operation === "delete" && audit.outcome === "deleted"),
    ).toBe(true);
    expect(JSON.stringify(audits)).not.toContain(prompt);
  });
});
