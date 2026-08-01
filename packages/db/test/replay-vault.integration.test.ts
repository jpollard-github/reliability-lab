import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ExecutionService, MapProviderRegistry } from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import type { LlmProvider } from "@reliability-lab/providers";
import {
  PostgresExecutionRepository,
  PostgresReplayCapsuleStore,
  replayCapsuleAudits,
  replayCapsules,
} from "../src/index.js";
import { useIntegrationDatabase } from "./support/database.js";

describe("Postgres replay vault", () => {
  const connection = useIntegrationDatabase();

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

  it("stores independent encrypted capsules for an opted-in live original, replay, and variant", async () => {
    if (!connection) return;
    const tenantId = `live-vault-${randomUUID()}`;
    const prompt = `live-capsule-secret-${randomUUID()}`;
    const key = Buffer.alloc(32, 9);
    let providerCalls = 0;
    const liveProvider: LlmProvider = {
      id: "live-provider",
      kind: "live",
      execute: async (request) => {
        providerCalls += 1;
        return {
          ok: true,
          response: {
            provider: "live-provider",
            model: request.model,
            outputText: "bounded live result",
            usage: { inputTokens: 1, outputTokens: 1 },
            latencyMs: 1,
          },
        };
      },
    };
    const repository = new PostgresExecutionRepository(connection.db);
    const service = new ExecutionService({
      repository,
      replayCapsules: new PostgresReplayCapsuleStore(connection.db, {
        activeVersion: "live-v1",
        keys: new Map([["live-v1", key]]),
      }),
      providers: new MapProviderRegistry([liveProvider]),
      allowLivePromptRetention: true,
    });
    const original = await service.execute({
      tenantId,
      body: {
        provider: "live-provider",
        model: "fixed-model",
        input: prompt,
        replayRetention: "encrypted",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const replay = await service.replay(tenantId, original.executionId);
    expect(replay.replayable).toBe(true);
    if (!replay.replayable) return;
    const comparison = await service.createComparison(tenantId, original.executionId, {
      policy: { maxAttempts: 1 },
    });
    const variant = await comparison.completion;
    expect(variant).toBeDefined();

    const rows = await connection.db
      .select()
      .from(replayCapsules)
      .where(eq(replayCapsules.tenantId, tenantId));
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.executionId)).size).toBe(3);
    expect(new Set(rows.map((row) => row.nonce.toString("base64"))).size).toBe(3);
    expect(new Set(rows.map((row) => row.ciphertext.toString("base64"))).size).toBe(3);
    expect(rows.every((row) => row.keyVersion === "live-v1")).toBe(true);
    expect(
      rows.some((row) =>
        Buffer.concat([row.ciphertext, row.nonce, row.authenticationTag]).includes(
          Buffer.from(prompt),
        ),
      ),
    ).toBe(false);
    expect(providerCalls).toBe(3);

    await service.deleteReplayCapsule(tenantId, original.executionId);
    expect((await service.get(tenantId, original.executionId)).status).toBe("succeeded");
    expect((await service.get(tenantId, original.executionId)).replayCapability.state).toBe(
      "deleted",
    );
    expect(
      (await service.get(tenantId, replay.replayExecution.executionId)).replayCapability.state,
    ).toBe("available");
    expect((await service.get(tenantId, variant!.executionId)).replayCapability.state).toBe(
      "available",
    );
  });
});
