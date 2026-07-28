import { and, asc, desc, eq, gt } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type {
  ComparisonExperiment,
  ExecutionEnvelope,
  ExecutionEvent,
  ExecutionId,
  TenantId,
} from "@reliability-lab/contracts";
import type { ComparisonExperimentRepository, ExecutionRepository } from "@reliability-lab/core";
import {
  comparisonExperiments,
  executionAttempts,
  executionEvents,
  executionJobs,
  executions,
  idempotencyRecords,
  replayCapsuleAudits,
  replayCapsules,
} from "./schema.js";

export * from "./durable-execution.js";
export * from "./execution-commands.js";
export * from "./investigation.js";
export * from "./replay-capsules.js";
export * from "./replay-runtime-config.js";
export {
  comparisonExperiments,
  executionJobs,
  replayCapsuleAudits,
  replayCapsules,
} from "./schema.js";

export type ReliabilityDatabase = NodePgDatabase<{
  comparisonExperiments: typeof comparisonExperiments;
  executions: typeof executions;
  executionAttempts: typeof executionAttempts;
  executionEvents: typeof executionEvents;
  executionJobs: typeof executionJobs;
  idempotencyRecords: typeof idempotencyRecords;
  replayCapsules: typeof replayCapsules;
  replayCapsuleAudits: typeof replayCapsuleAudits;
}>;

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, {
    schema: {
      executions,
      comparisonExperiments,
      executionAttempts,
      executionEvents,
      executionJobs,
      idempotencyRecords,
      replayCapsules,
      replayCapsuleAudits,
    },
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
      replayCapability: row.replayable
        ? {
            state: "available",
            available: true,
            reason: "Replay capsule is available",
          }
        : {
            state:
              row.replayUnavailableReason === "Live-provider request retention is disabled"
                ? "retention_disabled"
                : "missing",
            available: false,
            reason: row.replayUnavailableReason ?? "Replay capsule is unavailable",
          },
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

export class PostgresComparisonExperimentRepository implements ComparisonExperimentRepository {
  readonly #db: ReliabilityDatabase;

  constructor(db: ReliabilityDatabase) {
    this.#db = db;
  }

  async create(experiment: ComparisonExperiment) {
    await this.#db.insert(comparisonExperiments).values(toComparisonRow(experiment));
  }

  async update(experiment: ComparisonExperiment) {
    await this.#db
      .update(comparisonExperiments)
      .set({
        variantExecutionId: experiment.variantExecutionId ?? null,
        status: experiment.status,
        unavailableReason: experiment.unavailableReason ?? null,
        updatedAt: new Date(experiment.updatedAt),
      })
      .where(
        and(
          eq(comparisonExperiments.tenantId, experiment.tenantId),
          eq(comparisonExperiments.id, experiment.experimentId),
        ),
      );
  }

  async findById(tenantId: TenantId, experimentId: string) {
    const [row] = await this.#db
      .select()
      .from(comparisonExperiments)
      .where(
        and(
          eq(comparisonExperiments.tenantId, tenantId),
          eq(comparisonExperiments.id, experimentId),
        ),
      )
      .limit(1);
    if (!row) return null;
    return {
      schemaVersion: 1 as const,
      experimentId: row.id,
      tenantId: row.tenantId,
      originalExecutionId: row.originalExecutionId,
      status: row.status,
      requestedVariation: row.requestedVariation,
      resolvedVariant: row.resolvedVariant,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      ...(row.variantExecutionId ? { variantExecutionId: row.variantExecutionId } : {}),
      ...(row.unavailableReason ? { unavailableReason: row.unavailableReason } : {}),
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

function toComparisonRow(
  experiment: ComparisonExperiment,
): typeof comparisonExperiments.$inferInsert {
  return {
    id: experiment.experimentId,
    tenantId: experiment.tenantId,
    originalExecutionId: experiment.originalExecutionId,
    variantExecutionId: experiment.variantExecutionId,
    status: experiment.status,
    requestedVariation: experiment.requestedVariation,
    resolvedVariant: experiment.resolvedVariant,
    unavailableReason: experiment.unavailableReason,
    createdAt: new Date(experiment.createdAt),
    updatedAt: new Date(experiment.updatedAt),
  };
}
