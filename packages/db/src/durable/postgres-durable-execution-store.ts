/**
 * Owns PostgreSQL durable acceptance, claims, fencing, heartbeats, and completion.
 * Command cryptography and schema declarations remain separate collaborators.
 */
import { and, asc, eq, gt, lte, or, sql } from "drizzle-orm";
import type {
  ComparisonExperiment,
  ExecutionEnvelope,
  ExecutionEvent,
} from "@reliability-lab/contracts";
import {
  IdempotencyConflictError,
  type ClaimedExecutionJob,
  type DurableAcceptanceInput,
  type DurableAcceptancePort,
  type DurableComparisonAcceptanceInput,
  type DurableJobStore,
} from "@reliability-lab/core";
import {
  decryptExecutionCommand,
  encryptExecutionCommand,
  type ExecutionCommandKeyring,
} from "./execution-command-crypto.js";
import type { ReliabilityDatabase } from "../database/database.js";
import {
  comparisonExperiments,
  executionEvents,
  executionJobs,
  executions,
  idempotencyRecords,
} from "../schema/index.js";

export class PostgresDurableExecutionStore implements DurableAcceptancePort, DurableJobStore {
  readonly #db: ReliabilityDatabase;
  readonly #keyring: ExecutionCommandKeyring;
  readonly #now: () => Date;
  readonly #afterExecutionInsert: (() => void) | undefined;

  constructor(
    db: ReliabilityDatabase,
    keyring: ExecutionCommandKeyring,
    options: { now?: () => Date; afterExecutionInsert?: () => void } = {},
  ) {
    this.#db = db;
    this.#keyring = keyring;
    this.#now = options.now ?? (() => new Date());
    this.#afterExecutionInsert = options.afterExecutionInsert;
  }

  async acceptExecution(input: DurableAcceptanceInput): Promise<string> {
    const encrypted = this.#encrypt(input);
    return this.#db.transaction(async (transaction) => {
      if (input.idempotencyKeyHash) {
        await transaction.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([
            input.execution.tenantId,
            input.idempotencyKeyHash,
          ])}, 0))`,
        );
        const [record] = await transaction
          .select()
          .from(idempotencyRecords)
          .where(
            and(
              eq(idempotencyRecords.tenantId, input.execution.tenantId),
              eq(idempotencyRecords.keyHash, input.idempotencyKeyHash),
            ),
          )
          .limit(1);
        if (record) {
          if (record.requestHash !== input.requestHash) throw new IdempotencyConflictError();
          return record.executionId;
        }
      }
      await this.#insertExecutionAndJob(transaction, input, encrypted);
      if (input.idempotencyKeyHash) {
        await transaction.insert(idempotencyRecords).values({
          tenantId: input.execution.tenantId,
          keyHash: input.idempotencyKeyHash,
          requestHash: input.requestHash,
          executionId: input.execution.executionId,
        });
      }
      return input.execution.executionId;
    });
  }

  async acceptComparison(input: DurableComparisonAcceptanceInput): Promise<string> {
    const encrypted = this.#encrypt(input);
    return this.#db.transaction(async (transaction) => {
      await this.#insertExecutionAndJob(transaction, input, encrypted);
      await transaction.insert(comparisonExperiments).values(toComparisonRow(input.experiment));
      return input.execution.executionId;
    });
  }

  async claimNext(input: {
    workerId: string;
    leaseDurationMs: number;
  }): Promise<ClaimedExecutionJob | null> {
    const now = this.#now();
    const claimed = await this.#db.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(executionJobs)
        .where(
          and(
            lte(executionJobs.availableAt, now),
            or(
              eq(executionJobs.status, "pending"),
              and(eq(executionJobs.status, "leased"), lte(executionJobs.leaseExpiresAt, now)),
            ),
          ),
        )
        .orderBy(asc(executionJobs.availableAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!row) return null;
      const reclaimed = row.status === "leased";
      const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
      const claimVersion = row.claimCount + 1;
      await transaction
        .update(executionJobs)
        .set({
          status: "leased",
          leaseOwner: input.workerId,
          leaseExpiresAt,
          claimCount: claimVersion,
          startedAt: row.startedAt ?? now,
          updatedAt: now,
        })
        .where(eq(executionJobs.executionId, row.executionId));
      return { row, reclaimed, claimVersion, leaseExpiresAt };
    });
    if (!claimed) return null;
    const { row, reclaimed, claimVersion, leaseExpiresAt } = claimed;
    const claim = {
      tenantId: row.tenantId,
      executionId: row.executionId,
      workerId: input.workerId,
      claimVersion,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      reclaimed,
    };
    if (!row.ciphertext || !row.nonce || !row.authenticationTag) {
      return {
        ...claim,
        safeErrorCode: "execution_command_payload_missing",
      };
    }
    const key = this.#keyring.keys.get(row.keyVersion);
    if (!key) {
      return {
        ...claim,
        safeErrorCode: "execution_command_key_unavailable",
      };
    }
    try {
      return {
        ...claim,
        command: decryptExecutionCommand(
          {
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            authenticationTag: row.authenticationTag,
          },
          key,
          {
            purpose: "execution_command",
            tenantId: row.tenantId,
            executionId: row.executionId,
            payloadSchemaVersion: 1,
            keyVersion: row.keyVersion,
          },
        ),
      };
    } catch {
      return {
        ...claim,
        safeErrorCode: "execution_command_unreadable",
      };
    }
  }

  async heartbeat(input: {
    claim: {
      tenantId: string;
      executionId: string;
      workerId: string;
      claimVersion: number;
    };
    leaseDurationMs: number;
  }) {
    const now = this.#now();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
    const rows = await this.#db
      .update(executionJobs)
      .set({
        leaseExpiresAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(executionJobs.tenantId, input.claim.tenantId),
          eq(executionJobs.executionId, input.claim.executionId),
          eq(executionJobs.status, "leased"),
          eq(executionJobs.leaseOwner, input.claim.workerId),
          eq(executionJobs.claimCount, input.claim.claimVersion),
          gt(executionJobs.leaseExpiresAt, now),
        ),
      )
      .returning({ executionId: executionJobs.executionId });
    return rows.length === 1
      ? { kind: "owned" as const, leaseExpiresAt: leaseExpiresAt.toISOString() }
      : { kind: "ownership_lost" as const };
  }

  async assertOwned(claim: {
    tenantId: string;
    executionId: string;
    workerId: string;
    claimVersion: number;
  }) {
    const now = this.#now();
    const [row] = await this.#db
      .select({ leaseExpiresAt: executionJobs.leaseExpiresAt })
      .from(executionJobs)
      .where(
        and(
          eq(executionJobs.tenantId, claim.tenantId),
          eq(executionJobs.executionId, claim.executionId),
          eq(executionJobs.status, "leased"),
          eq(executionJobs.leaseOwner, claim.workerId),
          eq(executionJobs.claimCount, claim.claimVersion),
          gt(executionJobs.leaseExpiresAt, now),
        ),
      )
      .limit(1);
    return row?.leaseExpiresAt
      ? { kind: "owned" as const, leaseExpiresAt: row.leaseExpiresAt.toISOString() }
      : { kind: "ownership_lost" as const };
  }

  async finish(input: {
    claim: {
      tenantId: string;
      executionId: string;
      workerId: string;
      claimVersion: number;
    };
    status: "completed" | "failed" | "ambiguous";
    safeErrorCode?: string;
  }) {
    const now = this.#now();
    const rows = await this.#db
      .update(executionJobs)
      .set({
        status: input.status,
        ciphertext: null,
        nonce: null,
        authenticationTag: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastSafeErrorCode: input.safeErrorCode ?? null,
        terminalAt: now,
        payloadDeletedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(executionJobs.tenantId, input.claim.tenantId),
          eq(executionJobs.executionId, input.claim.executionId),
          eq(executionJobs.status, "leased"),
          eq(executionJobs.leaseOwner, input.claim.workerId),
          eq(executionJobs.claimCount, input.claim.claimVersion),
          gt(executionJobs.leaseExpiresAt, now),
        ),
      )
      .returning({ executionId: executionJobs.executionId });
    return rows.length === 1 ? { kind: "finished" as const } : { kind: "ownership_lost" as const };
  }

  #encrypt(input: DurableAcceptanceInput) {
    const key = this.#keyring.keys.get(this.#keyring.activeVersion);
    if (!key) throw new Error("Active execution command key is unavailable");
    return encryptExecutionCommand(input.command, key, {
      purpose: "execution_command",
      tenantId: input.execution.tenantId,
      executionId: input.execution.executionId,
      payloadSchemaVersion: 1,
      keyVersion: this.#keyring.activeVersion,
    });
  }

  async #insertExecutionAndJob(
    transaction: ReliabilityDatabase,
    input: DurableAcceptanceInput,
    encrypted: ReturnType<typeof encryptExecutionCommand>,
  ) {
    const now = this.#now();
    await transaction.insert(executions).values(toExecutionRow(input.execution));
    if (input.execution.events.length) {
      await transaction.insert(executionEvents).values(input.execution.events.map(toEventRow));
    }
    this.#afterExecutionInsert?.();
    await transaction.insert(executionJobs).values({
      executionId: input.execution.executionId,
      tenantId: input.execution.tenantId,
      status: "pending",
      payloadSchemaVersion: 1,
      keyVersion: this.#keyring.activeVersion,
      ciphertext: encrypted.ciphertext,
      nonce: encrypted.nonce,
      authenticationTag: encrypted.authenticationTag,
      availableAt: now,
      claimCount: 0,
      createdAt: now,
      updatedAt: now,
    });
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
    replayOfExecutionId: execution.replayOfExecutionId,
    replayable: execution.replayable,
    replayUnavailableReason: execution.replayUnavailableReason,
    createdAt: new Date(execution.createdAt),
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
