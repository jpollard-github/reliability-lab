import { describe, expect, it } from "vitest";
import type { ReplayCapsule } from "@reliability-lab/core";
import {
  decryptReplayCapsule,
  encryptReplayCapsule,
  type ReplayContext,
} from "../src/replay-capsules.js";

const key = Buffer.alloc(32, 7);
const context: ReplayContext = {
  tenantId: "tenant-a",
  executionId: "execution-a",
  payloadSchemaVersion: 1,
  keyVersion: "v1",
};
const capsule: ReplayCapsule = {
  providerRequest: {
    tenantId: "tenant-a",
    provider: "fake-primary",
    model: "v1",
    input: "recognizable prompt text",
  },
};

describe("replay capsule encryption", () => {
  it("round-trips with AES-256-GCM without plaintext in persisted fields", () => {
    const encrypted = encryptReplayCapsule(capsule, key, context);

    expect(encrypted.nonce).toHaveLength(12);
    expect(encrypted.authenticationTag).toHaveLength(16);
    expect(
      Buffer.concat([encrypted.ciphertext, encrypted.nonce, encrypted.authenticationTag]).includes(
        Buffer.from("recognizable prompt text"),
      ),
    ).toBe(false);
    expect(decryptReplayCapsule(encrypted, key, context)).toEqual(capsule);
  });

  it("uses a fresh nonce when encrypting the same payload repeatedly", () => {
    const first = encryptReplayCapsule(capsule, key, context);
    const second = encryptReplayCapsule(capsule, key, context);

    expect(first.nonce.equals(second.nonce)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it.each(["ciphertext", "authenticationTag", "context"] as const)(
    "fails safely when %s is tampered",
    (target) => {
      const encrypted = encryptReplayCapsule(capsule, key, context);
      const changed = {
        ciphertext: Buffer.from(encrypted.ciphertext),
        nonce: Buffer.from(encrypted.nonce),
        authenticationTag: Buffer.from(encrypted.authenticationTag),
      };
      const changedContext = { ...context };
      if (target === "context") changedContext.tenantId = "tenant-b";
      else changed[target][0] = (changed[target][0] ?? 0) ^ 1;

      expect(() => decryptReplayCapsule(changed, key, changedContext)).toThrow();
    },
  );

  it("supports read-old and write-current key semantics", () => {
    const oldKey = Buffer.alloc(32, 1);
    const currentKey = Buffer.alloc(32, 2);
    const oldContext = { ...context, keyVersion: "v1" };
    const currentContext = { ...context, keyVersion: "v2" };
    const oldCiphertext = encryptReplayCapsule(capsule, oldKey, oldContext);
    const currentCiphertext = encryptReplayCapsule(capsule, currentKey, currentContext);

    expect(decryptReplayCapsule(oldCiphertext, oldKey, oldContext)).toEqual(capsule);
    expect(decryptReplayCapsule(currentCiphertext, currentKey, currentContext)).toEqual(capsule);
    expect(() => decryptReplayCapsule(oldCiphertext, currentKey, oldContext)).toThrow();
  });
});
