import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionRepository } from "@reliability-lab/core";
import { executionAttempts, executionEvents, executions, idempotencyRecords } from "./schema.js";

type ReliabilityDatabase = NodePgDatabase<{
  executions: typeof executions;
  executionAttempts: typeof executionAttempts;
  executionEvents: typeof executionEvents;
  idempotencyRecords: typeof idempotencyRecords;
}>;

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, {
    schema: { executions, executionAttempts, executionEvents, idempotencyRecords },
  });
  return { db, pool };
}

export class PostgresExecutionRepository implements ExecutionRepository {
  readonly #db: ReliabilityDatabase;
  constructor(db: ReliabilityDatabase) {
    this.#db = db;
  }

  async create(execution: ExecutionEnvelope) {
    await this.#db.transaction(async (transaction) => {
      await transaction.insert(executions).values(toExecutionRow(execution));
      if (execution.events.length) {
        await transaction.insert(executionEvents).values(execution.events.map(toEventRow));
      }
    });
  }

  async update(execution: ExecutionEnvelope) {
    await this.#db.transaction(async (transaction) => {
      await transaction
        .update(executions)
        .set(toExecutionUpdate(execution))
        .where(eq(executions.id, execution.executionId));
      await transaction
        .delete(executionAttempts)
        .where(eq(executionAttempts.executionId, execution.executionId));
      if (execution.attempts.length) {
        await transaction.insert(executionAttempts).values(
          execution.attempts.map((attempt) => ({
            executionId: execution.executionId,
            attemptNumber: attempt.attemptNumber,
            data: attempt,
          })),
        );
      }
    });
  }

  async appendEvent(event: ExecutionEvent) {
    await this.#db.insert(executionEvents).values(toEventRow(event)).onConflictDoNothing();
  }

  async findById(tenantId: TenantId, executionId: ExecutionId) {
    const [row] = await this.#db
      .select()
      .from(executions)
      .where(and(eq(executions.tenantId, tenantId), eq(executions.id, executionId)))
      .limit(1);
    return row ? this.#hydrate(row) : null;
  }

  async list(tenantId?: TenantId) {
    const rows = tenantId
      ? await this.#db
          .select()
          .from(executions)
          .where(eq(executions.tenantId, tenantId))
          .orderBy(desc(executions.createdAt))
      : await this.#db.select().from(executions).orderBy(desc(executions.createdAt));
    return Promise.all(rows.map((row) => this.#hydrate(row)));
  }

  async findIdempotent(tenantId: TenantId, keyHash: string) {
    const [record] = await this.#db
      .select()
      .from(idempotencyRecords)
      .where(
        and(eq(idempotencyRecords.tenantId, tenantId), eq(idempotencyRecords.keyHash, keyHash)),
      )
      .limit(1);
    return record ? this.findById(tenantId, record.executionId) : null;
  }

  async recordIdempotency(
    tenantId: TenantId,
    keyHash: string,
    requestHash: string,
    executionId: ExecutionId,
  ) {
    await this.#db
      .insert(idempotencyRecords)
      .values({ tenantId, keyHash, requestHash, executionId })
      .onConflictDoNothing();
  }

  async #hydrate(row: typeof executions.$inferSelect): Promise<ExecutionEnvelope> {
    const [attemptRows, eventRows] = await Promise.all([
      this.#db
        .select()
        .from(executionAttempts)
        .where(eq(executionAttempts.executionId, row.id))
        .orderBy(asc(executionAttempts.attemptNumber)),
      this.#db
        .select()
        .from(executionEvents)
        .where(eq(executionEvents.executionId, row.id))
        .orderBy(asc(executionEvents.sequence)),
    ]);
    return {
      schemaVersion: 1,
      executionId: row.id,
      tenantId: row.tenantId,
      status: row.status,
      provider: row.provider,
      model: row.model,
      traceId: row.traceId,
      requestHash: row.requestHash,
      policy: row.policy,
      budget: row.budget,
      attempts: attemptRows.map((attempt) => attempt.data),
      events: eventRows.map((event) => event.data),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      replayable: row.replayable,
      ...(row.outputText === null ? {} : { outputText: row.outputText }),
      ...(row.outputJson === null ? {} : { outputJson: row.outputJson }),
      ...(row.error === null ? {} : { error: row.error }),
      ...(row.replayOfExecutionId === null ? {} : { replayOfExecutionId: row.replayOfExecutionId }),
      ...(row.replayUnavailableReason === null
        ? {}
        : { replayUnavailableReason: row.replayUnavailableReason }),
      ...(row.durationMs === null ? {} : { durationMs: row.durationMs }),
    };
  }
}

function toExecutionRow(execution: ExecutionEnvelope): typeof executions.$inferInsert {
  return {
    id: execution.executionId,
    tenantId: execution.tenantId,
    status: execution.status,
    provider: execution.provider,
    model: execution.model,
    traceId: execution.traceId,
    requestHash: execution.requestHash,
    policy: execution.policy,
    budget: execution.budget,
    outputText: execution.outputText,
    outputJson: execution.outputJson,
    error: execution.error,
    replayOfExecutionId: execution.replayOfExecutionId,
    replayable: execution.replayable,
    replayUnavailableReason: execution.replayUnavailableReason,
    durationMs: execution.durationMs,
    createdAt: new Date(execution.createdAt),
    updatedAt: new Date(execution.updatedAt),
  };
}

function toExecutionUpdate(execution: ExecutionEnvelope) {
  return {
    status: execution.status,
    provider: execution.provider,
    model: execution.model,
    outputText: execution.outputText ?? null,
    outputJson: execution.outputJson ?? null,
    error: execution.error ?? null,
    replayable: execution.replayable,
    replayUnavailableReason: execution.replayUnavailableReason ?? null,
    durationMs: execution.durationMs ?? null,
    updatedAt: new Date(execution.updatedAt),
  };
}

function toEventRow(event: ExecutionEvent): typeof executionEvents.$inferInsert {
  return {
    eventId: event.eventId,
    executionId: event.executionId,
    sequence: event.sequence,
    schemaVersion: event.schemaVersion,
    type: event.type,
    occurredAt: new Date(event.occurredAt),
    data: event,
  };
}
