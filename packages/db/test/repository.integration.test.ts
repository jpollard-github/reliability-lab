import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  encodeCaseCursor,
  encodeExecutionCursor,
  ExecutionService,
  InvestigationCaseService,
  MapProviderRegistry,
  MemoryReplayCapsuleStore,
} from "@reliability-lab/core";
import { DeterministicFakeProvider } from "@reliability-lab/providers";
import {
  createDatabase,
  PostgresComparisonExperimentRepository,
  PostgresExecutionRepository,
  PostgresInvestigationReadRepository,
  PostgresInvestigationCaseRepository,
  PostgresReplayCapsuleStore,
  replayCapsuleAudits,
  replayCapsules,
  investigationCaseEvidence,
  investigationCaseEvents,
  investigationCaseNotes,
  investigationCases,
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

  it("persists tenant-scoped saved cases, linked evidence, notes, and metadata timelines", async () => {
    if (!connection) return;
    const tenantId = `case-${randomUUID()}`;
    const otherTenant = `${tenantId}-other`;
    const promptMarker = `prohibited-prompt-${randomUUID()}`;
    const executionRepository = new PostgresExecutionRepository(connection.db);
    const comparisonRepository = new PostgresComparisonExperimentRepository(connection.db);
    const executionService = new ExecutionService({
      repository: executionRepository,
      comparisons: comparisonRepository,
      replayCapsules: new MemoryReplayCapsuleStore(),
      providers: new MapProviderRegistry([
        new DeterministicFakeProvider({ id: "fake-primary" }),
        new DeterministicFakeProvider({ id: "fake-fallback" }),
      ]),
    });
    const original = await executionService.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: promptMarker,
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const otherExecution = await executionService.execute({
      tenantId: otherTenant,
      body: { provider: "fake-primary", model: "v1", input: "other tenant" },
    });
    const comparison = await executionService.createComparison(tenantId, original.executionId, {
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    });
    await comparison.completion;

    const fixedNow = new Date();
    const repository = new PostgresInvestigationCaseRepository(connection.db);
    const caseService = new InvestigationCaseService({
      cases: repository,
      executions: executionRepository,
      comparisons: comparisonRepository,
      now: () => fixedNow,
    });
    const range = {
      from: new Date(fixedNow.getTime() - 60_000).toISOString(),
      to: new Date(fixedNow.getTime() + 60_000).toISOString(),
    };
    const created = await caseService.create(tenantId, {
      title: "Retry evidence",
      question: "Did bounded retry recover the selected execution?",
      importance: "notable",
      savedScope: {
        range,
        statuses: ["succeeded", "succeeded"],
        providers: ["fake-primary"],
        signal: "retry_recovered",
      },
    });
    await caseService.create(tenantId, {
      title: "Fallback evidence",
      question: "Was fallback selected?",
      savedScope: { range, signal: "fallback_used" },
    });
    await caseService.create(tenantId, {
      title: "Provider evidence",
      question: "Was the route unavailable?",
      savedScope: { range, errorCategory: "provider_unavailable" },
    });
    const executionLink = await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "execution",
      executionId: original.executionId,
    });
    const duplicate = await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "execution",
      executionId: original.executionId,
    });
    expect(duplicate).toEqual({ evidence: executionLink.evidence, added: false });
    await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "comparison",
      experimentId: comparison.experiment.experimentId,
    });
    await caseService.addEvidence(tenantId, created.case.caseId, {
      type: "provider_observation",
      provider: "fake-primary",
      model: "v1",
      range,
    });
    await caseService.addNote(tenantId, created.case.caseId, {
      body: "Second attempt recovered without fallback.",
    });
    await caseService.update(tenantId, created.case.caseId, {
      status: "resolved",
      finding: "The selected retry recovered.",
      resolution: "Keep bounded retry.",
    });

    const reconstructed = new InvestigationCaseService({
      cases: new PostgresInvestigationCaseRepository(connection.db),
      executions: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      now: () => fixedNow,
    });
    const detail = await reconstructed.get(tenantId, created.case.caseId);
    expect(detail).toMatchObject({
      case: {
        status: "resolved",
        resolvedAt: fixedNow.toISOString(),
        savedScope: { statuses: ["succeeded"] },
      },
      notes: [{ body: "Second attempt recovered without fallback." }],
    });
    expect(detail.evidence.map((item) => item.type).sort()).toEqual([
      "comparison",
      "execution",
      "provider_observation",
    ]);
    expect(JSON.stringify(detail.timeline)).not.toContain("Second attempt recovered");
    expect(JSON.stringify(detail.timeline)).not.toContain("The selected retry recovered");
    await expect(reconstructed.get(otherTenant, created.case.caseId)).rejects.toThrow(
      "Investigation case not found",
    );
    await expect(
      reconstructed.addEvidence(tenantId, created.case.caseId, {
        type: "execution",
        executionId: otherExecution.executionId,
      }),
    ).rejects.toThrow("Investigation case not found");

    const firstPage = await reconstructed.list(tenantId, { limit: 2 });
    expect(firstPage).toMatchObject({ total: 3 });
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await reconstructed.list(tenantId, {
      limit: 2,
      cursor: firstPage.nextCursor!,
    });
    expect(secondPage.data).toHaveLength(1);
    const last = secondPage.data[0]!.case;
    const emptyPage = await reconstructed.list(tenantId, {
      limit: 2,
      cursor: encodeCaseCursor(last.updatedAt, last.caseId),
    });
    expect(emptyPage).toMatchObject({ data: [], total: 3 });
    const filtered = await reconstructed.list(tenantId, {
      statuses: ["resolved"],
      importance: "notable",
      query: "retry",
      executionId: original.executionId,
    });
    expect(filtered.data.map((item) => item.case.caseId)).toEqual([created.case.caseId]);

    await reconstructed.removeEvidence(
      tenantId,
      created.case.caseId,
      executionLink.evidence.evidenceId,
    );
    expect(await executionRepository.findById(tenantId, original.executionId)).not.toBeNull();
    const archived = await reconstructed.update(tenantId, created.case.caseId, {
      status: "archived",
    });
    expect(archived.case).toMatchObject({ status: "archived" });
    expect(archived.case.resolvedAt).toBeUndefined();
    expect(archived.timeline.at(-2)?.type).toBe("case.updated");
    expect(archived.timeline.at(-1)?.type).toBe("case.status_changed");

    const [caseRows, noteRows, evidenceRows, eventRows] = await Promise.all([
      connection.db
        .select()
        .from(investigationCases)
        .where(eq(investigationCases.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseNotes)
        .where(eq(investigationCaseNotes.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseEvidence)
        .where(eq(investigationCaseEvidence.tenantId, tenantId)),
      connection.db
        .select()
        .from(investigationCaseEvents)
        .where(eq(investigationCaseEvents.tenantId, tenantId)),
    ]);
    expect(JSON.stringify({ caseRows, noteRows, evidenceRows, eventRows })).not.toContain(
      promptMarker,
    );
    expect(JSON.stringify(eventRows)).not.toContain("Second attempt recovered");
    expect(JSON.stringify(eventRows)).not.toContain("The selected retry recovered");

    const indexes = await connection.db.execute<{ indexname: string }>(sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'investigation_cases'
    `);
    expect(indexes.rows.map((row) => row.indexname)).toContain(
      "investigation_cases_tenant_status_updated_idx",
    );
  });

  it("persists comparative replay definitions and reconstructs their evidence", async () => {
    if (!connection) return;
    const tenantId = `comparison-${randomUUID()}`;
    const replayCapsules = new MemoryReplayCapsuleStore();
    const providers = new MapProviderRegistry([
      new DeterministicFakeProvider({ id: "fake-primary" }),
      new DeterministicFakeProvider({ id: "fake-fallback" }),
    ]);
    const service = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      replayCapsules,
      providers,
    });
    const original = await service.execute({
      tenantId,
      body: {
        provider: "fake-primary",
        model: "v1",
        input: "durable comparison",
        failureMode: "rate_limit",
        policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
      },
    });
    const comparison = await service.createComparison(tenantId, original.executionId, {
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    });
    await comparison.completion;

    const reconstructed = new ExecutionService({
      repository: new PostgresExecutionRepository(connection.db),
      comparisons: new PostgresComparisonExperimentRepository(connection.db),
      replayCapsules,
      providers,
    });
    const view = await reconstructed.getComparison(tenantId, comparison.experiment.experimentId);
    expect(view).toMatchObject({
      experiment: { status: "completed", originalExecutionId: original.executionId },
      variantExecution: { replayOfExecutionId: original.executionId, status: "degraded" },
    });
    await expect(
      reconstructed.getComparison("different-tenant", comparison.experiment.experimentId),
    ).rejects.toThrow("Comparison experiment not found");
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
