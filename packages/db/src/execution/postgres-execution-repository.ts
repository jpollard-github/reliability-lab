/**
 * Owns ordinary execution persistence and hydration.
 * The legacy unbounded list is retained only for package/API compatibility.
 */
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type {
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";
import type { ExecutionRepository } from "@reliability-lab/core";
import type { ReliabilityDatabase } from "../database/database.js";
import {
  executionAttempts,
  executionEvents,
  executions,
  idempotencyRecords,
} from "../schema/executions.js";
import {
  hydrateExecution,
  toExecutionEventInsert,
  toExecutionInsert,
  toExecutionUpdate,
} from "./execution-row-mappers.js";

export class PostgresExecutionRepository implements ExecutionRepository {
  readonly #db: ReliabilityDatabase;

  constructor(db: ReliabilityDatabase) {
    this.#db = db;
  }

  async create(execution: ExecutionEnvelope) {
    await this.#db.transaction(async (transaction) => {
      await transaction.insert(executions).values(toExecutionInsert(execution));
      if (execution.events.length) {
        await transaction
          .insert(executionEvents)
          .values(execution.events.map(toExecutionEventInsert));
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
    await this.#db
      .insert(executionEvents)
      .values(toExecutionEventInsert(event))
      .onConflictDoNothing();
  }

  async eventsAfter(tenantId: TenantId, executionId: ExecutionId, afterSequence: number) {
    const [execution] = await this.#db
      .select({ id: executions.id })
      .from(executions)
      .where(and(eq(executions.tenantId, tenantId), eq(executions.id, executionId)))
      .limit(1);
    if (!execution) return null;
    const rows = await this.#db
      .select({ data: executionEvents.data })
      .from(executionEvents)
      .where(
        and(
          eq(executionEvents.executionId, executionId),
          gt(executionEvents.sequence, afterSequence),
        ),
      )
      .orderBy(asc(executionEvents.sequence));
    return rows.map((row) => row.data);
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
    return hydrateExecution(row, attemptRows, eventRows);
  }
}
