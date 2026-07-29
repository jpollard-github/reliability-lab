/**
 * Owns transient durable-command encryption and runtime keyring parsing.
 * Replay capsule encryption is intentionally separate under replay/.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Value } from "@sinclair/typebox/value";
import {
  CreateExecutionBodySchema,
  type CreateExecutionBody,
  type ExecutionId,
  type TenantId,
} from "@reliability-lab/contracts";

export interface ExecutionCommandKeyring {
  activeVersion: string;
  keys: ReadonlyMap<string, Buffer>;
}

export interface ExecutionCommandContext {
  purpose: "execution_command";
  tenantId: TenantId;
  executionId: ExecutionId;
  payloadSchemaVersion: 1;
  keyVersion: string;
}

export interface EncryptedExecutionCommand {
  ciphertext: Buffer;
  nonce: Buffer;
  authenticationTag: Buffer;
}

export interface ExecutionRuntimeConfig {
  mode: "in_process" | "postgres_worker";
  keyring?: ExecutionCommandKeyring;
}

export function readExecutionRuntimeConfig(environment: NodeJS.ProcessEnv): ExecutionRuntimeConfig {
  const mode = environment.EXECUTION_MODE ?? "in_process";
  if (mode !== "in_process" && mode !== "postgres_worker") {
    throw new Error("EXECUTION_MODE must be 'in_process' or 'postgres_worker'");
  }
  if (mode === "in_process") return { mode };
  if (!environment.DATABASE_URL) {
    throw new Error("EXECUTION_MODE=postgres_worker requires DATABASE_URL");
  }
  const activeVersion = environment.EXECUTION_COMMAND_ACTIVE_KEY_VERSION;
  if (!activeVersion) {
    throw new Error("EXECUTION_MODE=postgres_worker requires EXECUTION_COMMAND_ACTIVE_KEY_VERSION");
  }
  const keys = parseKeyring(environment.EXECUTION_COMMAND_KEYS_JSON);
  if (!keys.has(activeVersion)) {
    throw new Error(
      "The active execution command key is not present in EXECUTION_COMMAND_KEYS_JSON",
    );
  }
  return { mode, keyring: { activeVersion, keys } };
}

export function encryptExecutionCommand(
  command: CreateExecutionBody,
  key: Buffer,
  context: ExecutionCommandContext,
): EncryptedExecutionCommand {
  assertExecutionCommandKey(key);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(canonicalJson(context)));
  const ciphertext = Buffer.concat([cipher.update(canonicalJson(command), "utf8"), cipher.final()]);
  return { ciphertext, nonce, authenticationTag: cipher.getAuthTag() };
}

export function decryptExecutionCommand(
  encrypted: EncryptedExecutionCommand,
  key: Buffer,
  context: ExecutionCommandContext,
): CreateExecutionBody {
  assertExecutionCommandKey(key);
  if (encrypted.nonce.length !== 12 || encrypted.authenticationTag.length !== 16) {
    throw new Error("Execution command cryptographic fields are invalid");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
  decipher.setAAD(Buffer.from(canonicalJson(context)));
  decipher.setAuthTag(encrypted.authenticationTag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
  return parseExecutionCommand(plaintext);
}

export function assertExecutionCommandKey(key: Buffer): void {
  if (key.length !== 32) {
    throw new Error("Execution command encryption keys must decode to 32 bytes");
  }
}

function parseKeyring(value: string | undefined): ReadonlyMap<string, Buffer> {
  if (!value) {
    throw new Error("EXECUTION_MODE=postgres_worker requires EXECUTION_COMMAND_KEYS_JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("EXECUTION_COMMAND_KEYS_JSON must be valid JSON");
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("EXECUTION_COMMAND_KEYS_JSON must be a non-empty object");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (
      !version ||
      typeof encoded !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
      Buffer.from(encoded, "base64").toString("base64") !== encoded
    ) {
      throw new Error("Each execution command key must be a named base64-encoded value");
    }
    const key = Buffer.from(encoded, "base64");
    assertExecutionCommandKey(key);
    keys.set(version, key);
  }
  return keys;
}

function parseExecutionCommand(value: string): CreateExecutionBody {
  const parsed: unknown = JSON.parse(value);
  if (!Value.Check(CreateExecutionBodySchema, parsed)) {
    throw new Error("Execution command payload is invalid");
  }
  return parsed;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
