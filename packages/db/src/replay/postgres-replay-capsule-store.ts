/**
 * Owns the tenant-scoped PostgreSQL replay-vault lifecycle and metadata-only audit trail.
 * Cryptographic helpers remain explicit beside the store until independently changed.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ExecutionId, ReplayCapability, TenantId } from "@reliability-lab/contracts";
import {
  availableCapability,
  deletedCapability,
  type ReplayCapsule,
  type ReplayCapsuleDeleteResult,
  type ReplayCapsuleReadResult,
  type ReplayCapsuleStore,
  type StoreReplayCapsule,
  unavailableCapability,
} from "@reliability-lab/core";
import { replayCapsuleAudits, replayCapsules } from "../schema/index.js";

export interface ReplayKeyring {
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface EncryptedReplayCapsule {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
}

export interface ReplayContext {
  tenantId: TenantId;
  executionId: ExecutionId;
  payloadSchemaVersion: number;
  keyVersion: string;
}

type ReplayVaultDatabase = NodePgDatabase<{
  replayCapsules: typeof replayCapsules;
  replayCapsuleAudits: typeof replayCapsuleAudits;
}>;

export class PostgresReplayCapsuleStore implements ReplayCapsuleStore {
  readonly #db: ReplayVaultDatabase;
  readonly #keyring: ReplayKeyring;
  readonly #now: () => Date;

  constructor(db: ReplayVaultDatabase, keyring: ReplayKeyring, now: () => Date = () => new Date()) {
    this.#db = db;
    this.#keyring = keyring;
    this.#now = now;
  }

  async put(input: StoreReplayCapsule): Promise<ReplayCapability> {
    const key = this.#keyring.keys.get(this.#keyring.activeVersion);
    if (!key) throw new Error("Active replay encryption key is unavailable");
    const context: ReplayContext = {
      tenantId: input.tenantId,
      executionId: input.executionId,
      payloadSchemaVersion: input.payloadSchemaVersion,
      keyVersion: this.#keyring.activeVersion,
    };
    const encrypted = encryptReplayCapsule(input.capsule, key, context);
    const now = this.#now();
    await this.#db.transaction(async (transaction) => {
      await transaction
        .insert(replayCapsules)
        .values({
          tenantId: input.tenantId,
          executionId: input.executionId,
          payloadSchemaVersion: input.payloadSchemaVersion,
          keyVersion: this.#keyring.activeVersion,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authenticationTag: encrypted.authenticationTag,
          createdAt: now,
          expiresAt: new Date(input.expiresAt),
          deletedAt: null,
          unreadableAt: null,
        })
        .onConflictDoUpdate({
          target: [replayCapsules.tenantId, replayCapsules.executionId],
          set: {
            payloadSchemaVersion: input.payloadSchemaVersion,
            keyVersion: this.#keyring.activeVersion,
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
            authenticationTag: encrypted.authenticationTag,
            createdAt: now,
            expiresAt: new Date(input.expiresAt),
            deletedAt: null,
            unreadableAt: null,
          },
        });
      await this.#audit(
        transaction,
        input.tenantId,
        input.executionId,
        "store",
        "stored",
        this.#keyring.activeVersion,
      );
    });
    return availableCapability(input.expiresAt);
  }

  async inspect(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapability> {
    return this.#db.transaction(async (transaction) => {
      const row = await selectCapsule(transaction, tenantId, executionId);
      const capability = this.#capability(row);
      await this.#audit(
        transaction,
        tenantId,
        executionId,
        "inspect",
        capability.state,
        row?.keyVersion,
      );
      return capability;
    });
  }

  async getForReplay(
    tenantId: TenantId,
    executionId: ExecutionId,
  ): Promise<ReplayCapsuleReadResult> {
    return this.#db.transaction(async (transaction) => {
      const row = await selectCapsule(transaction, tenantId, executionId);
      const capability = this.#capability(row);
      if (!capability.available || !row) {
        await this.#audit(
          transaction,
          tenantId,
          executionId,
          "read_for_replay",
          capability.state,
          row?.keyVersion,
        );
        return { available: false, capability };
      }

      const key = this.#keyring.keys.get(row.keyVersion);
      if (!key) {
        const unavailable = unavailableCapability(
          "key_unavailable",
          "Replay capsule key version is unavailable",
        );
        await this.#audit(
          transaction,
          tenantId,
          executionId,
          "read_for_replay",
          unavailable.state,
          row.keyVersion,
        );
        return { available: false, capability: unavailable };
      }

      try {
        const capsule = decryptReplayCapsule(
          {
            ciphertext: row.ciphertext,
            nonce: row.nonce,
            authenticationTag: row.authenticationTag,
          },
          key,
          {
            tenantId,
            executionId,
            payloadSchemaVersion: row.payloadSchemaVersion,
            keyVersion: row.keyVersion,
          },
        );
        await this.#audit(
          transaction,
          tenantId,
          executionId,
          "read_for_replay",
          "available",
          row.keyVersion,
        );
        return { available: true, capability, capsule };
      } catch {
        await transaction
          .update(replayCapsules)
          .set({ unreadableAt: this.#now() })
          .where(
            and(eq(replayCapsules.tenantId, tenantId), eq(replayCapsules.executionId, executionId)),
          );
        const unavailable = unavailableCapability(
          "unreadable",
          "Replay capsule could not be safely read",
        );
        await this.#audit(
          transaction,
          tenantId,
          executionId,
          "read_for_replay",
          unavailable.state,
          row.keyVersion,
        );
        return { available: false, capability: unavailable };
      }
    });
  }

  async delete(tenantId: TenantId, executionId: ExecutionId): Promise<ReplayCapsuleDeleteResult> {
    return this.#db.transaction(async (transaction) => {
      const row = await selectCapsule(transaction, tenantId, executionId);
      if (!row) {
        const capability = unavailableCapability("missing", "Replay capsule is unavailable");
        await this.#audit(transaction, tenantId, executionId, "delete", "already_absent");
        return { deleted: false, capability };
      }
      if (row.deletedAt) {
        const capability = deletedCapability(
          row.deletedAt.toISOString(),
          row.expiresAt.toISOString(),
        );
        await this.#audit(
          transaction,
          tenantId,
          executionId,
          "delete",
          "already_deleted",
          row.keyVersion,
        );
        return { deleted: false, capability };
      }

      const deletedAt = this.#now();
      await transaction
        .update(replayCapsules)
        .set({ deletedAt })
        .where(
          and(eq(replayCapsules.tenantId, tenantId), eq(replayCapsules.executionId, executionId)),
        );
      await this.#audit(transaction, tenantId, executionId, "delete", "deleted", row.keyVersion);
      return {
        deleted: true,
        capability: deletedCapability(deletedAt.toISOString(), row.expiresAt.toISOString()),
      };
    });
  }

  #capability(row: typeof replayCapsules.$inferSelect | undefined): ReplayCapability {
    if (!row) return unavailableCapability("missing", "Replay capsule is unavailable");
    if (row.deletedAt) {
      return deletedCapability(row.deletedAt.toISOString(), row.expiresAt.toISOString());
    }
    if (row.unreadableAt) {
      return unavailableCapability("unreadable", "Replay capsule could not be safely read");
    }
    if (row.expiresAt.getTime() <= this.#now().getTime()) {
      return {
        ...unavailableCapability("expired", "Replay capsule retention has expired"),
        expiresAt: row.expiresAt.toISOString(),
      };
    }
    if (!this.#keyring.keys.has(row.keyVersion)) {
      return unavailableCapability("key_unavailable", "Replay capsule key version is unavailable");
    }
    return availableCapability(row.expiresAt.toISOString());
  }

  async #audit(
    transaction: ReplayVaultDatabase,
    tenantId: TenantId,
    executionId: ExecutionId,
    operation: string,
    outcome: string,
    keyVersion?: string,
  ) {
    await transaction.insert(replayCapsuleAudits).values({
      auditId: randomUUID(),
      tenantId,
      executionId,
      operation,
      outcome,
      occurredAt: this.#now(),
      ...(keyVersion ? { keyVersion } : {}),
    });
  }
}

export function encryptReplayCapsule(
  capsule: ReplayCapsule,
  key: Buffer,
  context: ReplayContext,
): EncryptedReplayCapsule {
  assertReplayKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(context)));
  const ciphertext = Buffer.concat([cipher.update(canonicalJson(capsule), "utf8"), cipher.final()]);
  return { ciphertext, nonce, authenticationTag: cipher.getAuthTag() };
}

export function decryptReplayCapsule(
  encrypted: EncryptedReplayCapsule,
  key: Buffer,
  context: ReplayContext,
): ReplayCapsule {
  assertReplayKey(key);
  if (encrypted.nonce.length !== 12 || encrypted.authenticationTag.length !== 16) {
    throw new Error("Replay capsule cryptographic fields are invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(Buffer.from(canonicalJson(context)));
  decipher.setAuthTag(encrypted.authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return parseReplayCapsule(plaintext, context.tenantId);
}

export function assertReplayKey(key: Buffer): void {
  if (key.length !== 32) throw new Error("Replay encryption keys must decode to 32 bytes");
}

function parseReplayCapsule(value: string, tenantId: TenantId): ReplayCapsule {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.providerRequest)) throw new Error("Invalid capsule");
  const request = parsed.providerRequest;
  if (
    request.tenantId !== tenantId ||
    typeof request.provider !== "string" ||
    typeof request.model !== "string"
  ) {
    throw new Error("Invalid capsule");
  }
  if (request.input !== undefined && typeof request.input !== "string") {
    throw new Error("Invalid capsule");
  }
  if (request.messages !== undefined && !isMessages(request.messages)) {
    throw new Error("Invalid capsule");
  }
  if (request.structuredOutputSchema !== undefined && !isRecord(request.structuredOutputSchema)) {
    throw new Error("Invalid capsule");
  }
  const failureModes = ["latency", "timeout", "rate_limit", "malformed_json", "provider_error"];
  if (
    request.failureMode !== undefined &&
    (typeof request.failureMode !== "string" || !failureModes.includes(request.failureMode))
  ) {
    throw new Error("Invalid capsule");
  }
  return parsed as unknown as ReplayCapsule;
}

function isMessages(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        isRecord(message) &&
        ["system", "user", "assistant"].includes(String(message.role)) &&
        typeof message.content === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function selectCapsule(
  database: ReplayVaultDatabase,
  tenantId: TenantId,
  executionId: ExecutionId,
) {
  const [row] = await database
    .select()
    .from(replayCapsules)
    .where(and(eq(replayCapsules.tenantId, tenantId), eq(replayCapsules.executionId, executionId)))
    .limit(1);
  return row;
}
