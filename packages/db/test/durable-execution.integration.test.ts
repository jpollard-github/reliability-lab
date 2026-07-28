import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  DurableExecutionWorker,
  ExecutionService,
  IdempotencyConflictError,
  MapProviderRegistry,
} from "@reliability-lab/core";
import { DeterministicFakeProvider, type LlmProvider } from "@reliability-lab/providers";
import {
  comparisonExperiments,
  createDatabase,
  executionJobs,
  PostgresComparisonExperimentRepository,
  PostgresDurableExecutionStore,
  PostgresExecutionRepository,
  PostgresReplayCapsuleStore,
  replayCapsuleAudits,
  replayCapsules,
} from "../src/index.js";
import {
  executionAttempts,
  executionEvents,
  executions,
  idempotencyRecords,
} from "../src/schema.js";

const commandKeyV1 = Buffer.alloc(32, 11);
const commandKeyV2 = Buffer.alloc(32, 12);
const replayKey = Buffer.alloc(32, 13);

describe("PostgreSQL durable execution", () => {
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

  beforeEach(async () => {
    if (connection) await clearDurableFixtures(connection.db);
  });

  afterAll(async () => {
    if (connection) {
      await clearDurableFixtures(connection.db);
      await connection.pool.end();
    }
  });

  it("atomically accepts encrypted work and rolls back every row on injected failure", async () => {
    if (!connection) return;
    const tenantId = `durable-atomic-${randomUUID()}`;
    const recognizable = `plaintext-${randomUUID()}`;
    const store = durableStore(connection.db);
    const service = durableService(connection.db, store);
    const accepted = await service.submit({
      tenantId,
      idempotencyKey: "atomic-key",
      body: {
        provider: "fake-primary",
        model: "v1",
        input: recognizable,
      },
    });

    const [executionRows, eventRows, jobRows, idempotencyRows] = await Promise.all([
      connection.db.select().from(executions).where(eq(executions.tenantId, tenantId)),
      connection.db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.executionId, accepted.execution.executionId)),
      connection.db.select().from(executionJobs).where(eq(executionJobs.tenantId, tenantId)),
      connection.db
        .select()
        .from(idempotencyRecords)
        .where(eq(idempotencyRecords.tenantId, tenantId)),
    ]);
    expect(executionRows).toHaveLength(1);
    expect(eventRows.map((row) => row.type)).toEqual(["execution.accepted", "execution.queued"]);
    expect(jobRows).toHaveLength(1);
    expect(jobRows[0]).toMatchObject({ status: "pending", claimCount: 0, keyVersion: "v1" });
    expect(
      Buffer.concat([
        jobRows[0]?.ciphertext ?? Buffer.alloc(0),
        jobRows[0]?.nonce ?? Buffer.alloc(0),
        jobRows[0]?.authenticationTag ?? Buffer.alloc(0),
      ]).includes(Buffer.from(recognizable)),
    ).toBe(false);
    expect(idempotencyRows).toHaveLength(1);
    await expect(service.get("different-tenant", accepted.execution.executionId)).rejects.toThrow(
      "Execution not found",
    );

    const rollbackTenant = `durable-rollback-${randomUUID()}`;
    const failingStore = durableStore(connection.db, {
      afterExecutionInsert: () => {
        throw new Error("injected acceptance failure");
      },
    });
    await expect(
      durableService(connection.db, failingStore).submit({
        tenantId: rollbackTenant,
        body: { provider: "fake-primary", model: "v1", input: "must roll back" },
      }),
    ).rejects.toThrow("injected acceptance failure");
    expect(
      await connection.db.select().from(executions).where(eq(executions.tenantId, rollbackTenant)),
    ).toHaveLength(0);
    expect(
      await connection.db
        .select()
        .from(executionJobs)
        .where(eq(executionJobs.tenantId, rollbackTenant)),
    ).toHaveLength(0);
  });

  it("serializes concurrent idempotent acceptance and preserves conflict behavior", async () => {
    if (!connection) return;
    const tenantId = `durable-idempotency-${randomUUID()}`;
    const service = durableService(connection.db, durableStore(connection.db));
    const submissions = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.submit({
          tenantId,
          idempotencyKey: "concurrent-key",
          body: { provider: "fake-primary", model: "v1", input: "same request" },
        }),
      ),
    );

    expect(new Set(submissions.map((item) => item.execution.executionId)).size).toBe(1);
    expect(
      await connection.db.select().from(executions).where(eq(executions.tenantId, tenantId)),
    ).toHaveLength(1);
    expect(
      await connection.db.select().from(executionJobs).where(eq(executionJobs.tenantId, tenantId)),
    ).toHaveLength(1);
    await expect(
      service.submit({
        tenantId,
        idempotencyKey: "concurrent-key",
        body: { provider: "fake-primary", model: "v1", input: "different request" },
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("claims exclusively and reclaims an expired untouched lease", async () => {
    if (!connection) return;
    const tenantId = `durable-lease-${randomUUID()}`;
    let now = new Date("2026-07-28T12:00:00.000Z");
    const store = durableStore(connection.db, { now: () => now });
    const service = durableService(connection.db, store);
    await service.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "lease me" },
    });

    const [first, competing] = await Promise.all([
      store.claimNext({ workerId: "worker-a", leaseDurationMs: 1_000 }),
      store.claimNext({ workerId: "worker-b", leaseDurationMs: 1_000 }),
    ]);
    expect([first, competing].filter(Boolean)).toHaveLength(1);
    expect(await store.claimNext({ workerId: "worker-c", leaseDurationMs: 1_000 })).toBeNull();
    now = new Date(now.getTime() + 1_001);
    const reclaimed = await store.claimNext({ workerId: "worker-c", leaseDurationMs: 1_000 });
    expect(reclaimed).toMatchObject({ tenantId, reclaimed: true });
  });

  it("reconciles terminal jobs without rerunning and cleans the transient command only", async () => {
    if (!connection) return;
    const tenantId = `durable-terminal-${randomUUID()}`;
    let providerCalls = 0;
    const provider = countingProvider(() => {
      providerCalls += 1;
    });
    const store = durableStore(connection.db);
    const service = durableService(connection.db, store, [provider]);
    const accepted = await service.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "terminal reconcile" },
    });
    const repository = new PostgresExecutionRepository(connection.db);
    const execution = (await repository.findById(tenantId, accepted.execution.executionId))!;
    execution.status = "succeeded";
    await repository.update(execution);

    await worker(store, service, "terminal-worker").runOnce();
    expect(providerCalls).toBe(0);
    const [job] = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.executionId, execution.executionId));
    expect(job).toMatchObject({
      status: "completed",
      ciphertext: null,
      nonce: null,
      authenticationTag: null,
    });
    expect(job?.payloadDeletedAt).toBeInstanceOf(Date);
  });

  it("turns an expired lease with provider activity into explicit ambiguity", async () => {
    if (!connection) return;
    const tenantId = `durable-ambiguous-${randomUUID()}`;
    let now = new Date("2026-07-28T13:00:00.000Z");
    let providerCalls = 0;
    const store = durableStore(connection.db, { now: () => now });
    const service = durableService(connection.db, store, [
      countingProvider(() => {
        providerCalls += 1;
      }),
    ]);
    const accepted = await service.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "ambiguous call" },
    });
    await store.claimNext({ workerId: "lost-worker", leaseDurationMs: 1_000 });
    const repository = new PostgresExecutionRepository(connection.db);
    const execution = (await repository.findById(tenantId, accepted.execution.executionId))!;
    execution.status = "running";
    execution.attempts.push({
      attemptNumber: 1,
      provider: "fake-primary",
      model: "v1",
      status: "running",
      startedAt: now.toISOString(),
    });
    const attemptEvent = {
      schemaVersion: 1 as const,
      eventId: randomUUID(),
      executionId: execution.executionId,
      sequence: execution.events.length + 1,
      occurredAt: now.toISOString(),
      type: "attempt.started" as const,
      attemptNumber: 1,
      provider: "fake-primary",
      model: "v1",
    };
    execution.events.push(attemptEvent);
    await repository.appendEvent(attemptEvent);
    await repository.update(execution);
    now = new Date(now.getTime() + 1_001);

    await worker(store, service, "recovery-worker").runOnce();
    const recovered = await repository.findById(tenantId, execution.executionId);
    expect(recovered?.error).toMatchObject({
      code: "provider_call_outcome_unknown",
      retryable: false,
    });
    expect(recovered?.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["execution.recovery_detected", "attempt.outcome_ambiguous"]),
    );
    expect(providerCalls).toBe(0);
    const [job] = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.executionId, execution.executionId));
    expect(job).toMatchObject({ status: "ambiguous", ciphertext: null });
  });

  it("completes through the worker, rotates command keys, and keeps replay lifecycle independent", async () => {
    if (!connection) return;
    const tenantId = `durable-lifecycle-${randomUUID()}`;
    const v1Store = durableStore(connection.db);
    const service = durableService(connection.db, v1Store);
    const accepted = await service.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "read old key" },
    });
    const rotatedStore = new PostgresDurableExecutionStore(connection.db, {
      activeVersion: "v2",
      keys: new Map([
        ["v1", commandKeyV1],
        ["v2", commandKeyV2],
      ]),
    });
    await worker(rotatedStore, service, "rotation-worker").runOnce();

    const [job, capsule] = await Promise.all([
      connection.db
        .select()
        .from(executionJobs)
        .where(eq(executionJobs.executionId, accepted.execution.executionId))
        .then((rows) => rows[0]),
      connection.db
        .select()
        .from(replayCapsules)
        .where(
          and(
            eq(replayCapsules.tenantId, tenantId),
            eq(replayCapsules.executionId, accepted.execution.executionId),
          ),
        )
        .then((rows) => rows[0]),
    ]);
    expect(job).toMatchObject({ keyVersion: "v1", status: "completed", ciphertext: null });
    expect(capsule?.ciphertext).toBeInstanceOf(Buffer);

    const replay = await service.replay(tenantId, accepted.execution.executionId);
    expect(replay).toMatchObject({ replayable: true, outcomeMatches: null });
    if (!replay.replayable) return;
    await worker(rotatedStore, service, "replay-worker").runOnce();
    const completedReplay = await service.get(tenantId, replay.replayExecution.executionId);
    expect(completedReplay.status).toBe("succeeded");
    expect(completedReplay.events.at(-1)).toMatchObject({
      type: "replay.completed",
      outcomeMatches: true,
    });

    await service.deleteReplayCapsule(tenantId, accepted.execution.executionId);
    const [jobAfterDeletion] = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.executionId, accepted.execution.executionId));
    expect(jobAfterDeletion).toMatchObject({
      status: "completed",
      payloadDeletedAt: job?.payloadDeletedAt,
    });

    const rotatedService = durableService(connection.db, rotatedStore);
    const next = await rotatedService.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "write current key" },
    });
    const [nextJob] = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.executionId, next.execution.executionId));
    expect(nextJob?.keyVersion).toBe("v2");
  });

  it("fails safely and deletes the command when its stored key version is unavailable", async () => {
    if (!connection) return;
    const tenantId = `durable-missing-key-${randomUUID()}`;
    const acceptingStore = durableStore(connection.db);
    const service = durableService(connection.db, acceptingStore);
    const accepted = await service.submit({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "missing old key" },
    });
    const missingOldKeyStore = new PostgresDurableExecutionStore(connection.db, {
      activeVersion: "v2",
      keys: new Map([["v2", commandKeyV2]]),
    });

    await worker(missingOldKeyStore, service, "missing-key-worker").runOnce();
    expect(await service.get(tenantId, accepted.execution.executionId)).toMatchObject({
      status: "failed",
      error: { code: "execution_command_key_unavailable" },
    });
    const [job] = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.executionId, accepted.execution.executionId));
    expect(job).toMatchObject({
      status: "failed",
      lastSafeErrorCode: "execution_command_key_unavailable",
      ciphertext: null,
    });
  });

  it("atomically persists a comparison experiment, variant, replay evidence, and job", async () => {
    if (!connection) return;
    const tenantId = `durable-comparison-${randomUUID()}`;
    const originalService = inProcessService(connection.db);
    const original = await originalService.execute({
      tenantId,
      body: { provider: "fake-primary", model: "v1", input: "fixed comparison input" },
    });
    const store = durableStore(connection.db);
    const durable = durableService(connection.db, store);
    const comparison = await durable.createComparison(tenantId, original.executionId, {
      model: "v2",
    });

    expect(comparison.variantExecution).toMatchObject({
      status: "queued",
      replayOfExecutionId: original.executionId,
    });
    const [experiments, jobs] = await Promise.all([
      connection.db
        .select()
        .from(comparisonExperiments)
        .where(eq(comparisonExperiments.id, comparison.experiment.experimentId)),
      connection.db
        .select()
        .from(executionJobs)
        .where(eq(executionJobs.executionId, comparison.variantExecution!.executionId)),
    ]);
    expect(experiments).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(comparison.variantExecution?.events.map((event) => event.type)).toEqual([
      "execution.accepted",
      "replay.started",
      "execution.queued",
    ]);

    const baseline = await connection.db
      .select()
      .from(executions)
      .where(eq(executions.tenantId, tenantId));
    const experimentBaseline = await connection.db
      .select()
      .from(comparisonExperiments)
      .where(eq(comparisonExperiments.tenantId, tenantId));
    const jobBaseline = await connection.db
      .select()
      .from(executionJobs)
      .where(eq(executionJobs.tenantId, tenantId));
    const failingStore = durableStore(connection.db, {
      afterExecutionInsert: () => {
        throw new Error("comparison transaction failure");
      },
    });
    await expect(
      durableService(connection.db, failingStore).createComparison(tenantId, original.executionId, {
        model: "v3",
      }),
    ).rejects.toThrow("comparison transaction failure");
    expect(
      await connection.db.select().from(executions).where(eq(executions.tenantId, tenantId)),
    ).toHaveLength(baseline.length);
    expect(
      await connection.db
        .select()
        .from(comparisonExperiments)
        .where(eq(comparisonExperiments.tenantId, tenantId)),
    ).toHaveLength(experimentBaseline.length);
    expect(
      await connection.db.select().from(executionJobs).where(eq(executionJobs.tenantId, tenantId)),
    ).toHaveLength(jobBaseline.length);
  });
});

type Database = NonNullable<ReturnType<typeof createDatabase>>["db"];

function durableStore(
  database: Database,
  options: { now?: () => Date; afterExecutionInsert?: () => void } = {},
) {
  return new PostgresDurableExecutionStore(
    database,
    { activeVersion: "v1", keys: new Map([["v1", commandKeyV1]]) },
    options,
  );
}

function durableService(
  database: Database,
  store: PostgresDurableExecutionStore,
  providers: LlmProvider[] = [new DeterministicFakeProvider({ id: "fake-primary" })],
) {
  return new ExecutionService({
    repository: new PostgresExecutionRepository(database),
    comparisons: new PostgresComparisonExperimentRepository(database),
    replayCapsules: new PostgresReplayCapsuleStore(database, {
      activeVersion: "replay-v1",
      keys: new Map([["replay-v1", replayKey]]),
    }),
    providers: new MapProviderRegistry(providers),
    durableAcceptance: store,
  });
}

function inProcessService(database: Database) {
  return new ExecutionService({
    repository: new PostgresExecutionRepository(database),
    comparisons: new PostgresComparisonExperimentRepository(database),
    replayCapsules: new PostgresReplayCapsuleStore(database, {
      activeVersion: "replay-v1",
      keys: new Map([["replay-v1", replayKey]]),
    }),
    providers: new MapProviderRegistry([new DeterministicFakeProvider({ id: "fake-primary" })]),
  });
}

function worker(store: PostgresDurableExecutionStore, service: ExecutionService, workerId: string) {
  return new DurableExecutionWorker({
    jobs: store,
    service,
    workerId,
    leaseDurationMs: 30_000,
    heartbeatIntervalMs: 10_000,
  });
}

function countingProvider(onCall: () => void): LlmProvider {
  return {
    id: "fake-primary",
    kind: "fake",
    execute: async (request) => {
      onCall();
      return {
        ok: true,
        response: {
          provider: "fake-primary",
          model: request.model,
          outputText: "complete",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        },
      };
    },
  };
}

async function clearDurableFixtures(database: Database) {
  await database.transaction(async (transaction) => {
    await transaction.execute(
      sql`delete from ${comparisonExperiments} where ${comparisonExperiments.tenantId} like 'durable-%'`,
    );
    await transaction.execute(
      sql`delete from ${replayCapsuleAudits} where ${replayCapsuleAudits.tenantId} like 'durable-%'`,
    );
    await transaction.execute(
      sql`delete from ${replayCapsules} where ${replayCapsules.tenantId} like 'durable-%'`,
    );
    await transaction.execute(
      sql`delete from ${executionJobs} where ${executionJobs.tenantId} like 'durable-%'`,
    );
    await transaction.execute(
      sql`delete from ${idempotencyRecords} where ${idempotencyRecords.tenantId} like 'durable-%'`,
    );
    await transaction.execute(
      sql`delete from ${executionAttempts} where ${executionAttempts.executionId} in (
        select ${executions.id} from ${executions} where ${executions.tenantId} like 'durable-%'
      )`,
    );
    await transaction.execute(
      sql`delete from ${executionEvents} where ${executionEvents.executionId} in (
        select ${executions.id} from ${executions} where ${executions.tenantId} like 'durable-%'
      )`,
    );
    await transaction.execute(
      sql`delete from ${executions} where ${executions.tenantId} like 'durable-%'`,
    );
  });
}
