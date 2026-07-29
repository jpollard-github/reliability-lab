import { describe, expect, it } from "vitest";
import type { CreateExecutionBody } from "@reliability-lab/contracts";
import type { ReplayCapsule } from "@reliability-lab/core";
import {
  decryptExecutionCommand,
  encryptExecutionCommand,
  readExecutionRuntimeConfig,
  type ExecutionCommandContext,
} from "../src/durable/execution-command-crypto.js";
import { encryptReplayCapsule } from "../src/replay/postgres-replay-capsule-store.js";

const key = Buffer.alloc(32, 9);
const context: ExecutionCommandContext = {
  purpose: "execution_command",
  tenantId: "tenant-a",
  executionId: "execution-a",
  payloadSchemaVersion: 1,
  keyVersion: "v1",
};
const command: CreateExecutionBody = {
  provider: "fake-primary",
  model: "v1",
  input: "recognizable execution command",
  structuredOutputSchema: { type: "object" },
};

describe("execution command encryption", () => {
  it("round-trips without recognizable plaintext and uses a fresh nonce", () => {
    const first = encryptExecutionCommand(command, key, context);
    const second = encryptExecutionCommand(command, key, context);

    expect(first.nonce).toHaveLength(12);
    expect(first.authenticationTag).toHaveLength(16);
    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(
      Buffer.concat([first.ciphertext, first.nonce, first.authenticationTag]).includes(
        Buffer.from("recognizable execution command"),
      ),
    ).toBe(false);
    expect(decryptExecutionCommand(first, key, context)).toEqual(command);
  });

  it.each(["ciphertext", "authenticationTag", "aad"] as const)(
    "fails safely when %s is tampered",
    (target) => {
      const encrypted = encryptExecutionCommand(command, key, context);
      const changed = {
        ciphertext: Buffer.from(encrypted.ciphertext),
        nonce: Buffer.from(encrypted.nonce),
        authenticationTag: Buffer.from(encrypted.authenticationTag),
      };
      const changedContext = { ...context };
      if (target === "aad") changedContext.tenantId = "tenant-b";
      else changed[target][0] = (changed[target][0] ?? 0) ^ 1;

      expect(() => decryptExecutionCommand(changed, key, changedContext)).toThrow();
    },
  );

  it("supports read-old/write-current key rotation", () => {
    const oldKey = Buffer.alloc(32, 1);
    const currentKey = Buffer.alloc(32, 2);
    const oldContext = { ...context, keyVersion: "v1" };
    const currentContext = { ...context, keyVersion: "v2" };
    const oldPayload = encryptExecutionCommand(command, oldKey, oldContext);
    const currentPayload = encryptExecutionCommand(command, currentKey, currentContext);

    expect(decryptExecutionCommand(oldPayload, oldKey, oldContext)).toEqual(command);
    expect(decryptExecutionCommand(currentPayload, currentKey, currentContext)).toEqual(command);
    expect(() => decryptExecutionCommand(oldPayload, currentKey, oldContext)).toThrow();
  });

  it("cannot decrypt replay ciphertext under execution-command AAD", () => {
    const replay: ReplayCapsule = {
      providerRequest: {
        tenantId: "tenant-a",
        provider: "fake-primary",
        model: "v1",
        input: "recognizable execution command",
      },
    };
    const encrypted = encryptReplayCapsule(replay, key, {
      tenantId: context.tenantId,
      executionId: context.executionId,
      payloadSchemaVersion: 1,
      keyVersion: "v1",
    });

    expect(() => decryptExecutionCommand(encrypted, key, context)).toThrow();
  });

  it("rejects an authenticated command that does not match the command schema", () => {
    const invalid = encryptExecutionCommand(
      {
        provider: "fake-primary",
        model: "v1",
        policy: { maxAttempts: 99 },
      } as CreateExecutionBody,
      key,
      context,
    );

    expect(() => decryptExecutionCommand(invalid, key, context)).toThrow(
      "Execution command payload is invalid",
    );
  });
});

describe("execution runtime configuration", () => {
  const encodedKey = Buffer.alloc(32, 3).toString("base64");

  it("defaults to in-process execution", () => {
    expect(readExecutionRuntimeConfig({})).toEqual({ mode: "in_process" });
  });

  it("fails closed for invalid durable prerequisites", () => {
    expect(() => readExecutionRuntimeConfig({ EXECUTION_MODE: "postgres_worker" })).toThrow(
      "requires DATABASE_URL",
    );
    expect(() =>
      readExecutionRuntimeConfig({
        EXECUTION_MODE: "postgres_worker",
        DATABASE_URL: "postgresql://local",
        EXECUTION_COMMAND_ACTIVE_KEY_VERSION: "v1",
        EXECUTION_COMMAND_KEYS_JSON: JSON.stringify({ v1: "dG9vLXNob3J0" }),
      }),
    ).toThrow("32 bytes");
  });

  it("accepts read-old/write-current durable keyrings", () => {
    const config = readExecutionRuntimeConfig({
      EXECUTION_MODE: "postgres_worker",
      DATABASE_URL: "postgresql://local",
      EXECUTION_COMMAND_ACTIVE_KEY_VERSION: "v2",
      EXECUTION_COMMAND_KEYS_JSON: JSON.stringify({ v1: encodedKey, v2: encodedKey }),
    });

    expect(config.mode).toBe("postgres_worker");
    expect(config.keyring?.activeVersion).toBe("v2");
    expect(config.keyring?.keys.has("v1")).toBe(true);
  });
});
