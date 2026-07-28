import { assertReplayKey, type ReplayKeyring } from "./replay-capsules.js";

export interface ReplayRuntimeConfig {
  storeMode: "memory" | "postgres";
  allowLivePromptRetention: boolean;
  retentionMs: number;
  keyring?: ReplayKeyring;
}

export function readReplayRuntimeConfig(environment: NodeJS.ProcessEnv): ReplayRuntimeConfig {
  const storeValue = environment.REPLAY_CAPSULE_STORE ?? "memory";
  if (storeValue !== "memory" && storeValue !== "postgres") {
    throw new Error("REPLAY_CAPSULE_STORE must be 'memory' or 'postgres'");
  }
  const allowLivePromptRetention = environment.ALLOW_LIVE_PROMPT_RETENTION === "true";
  const retentionHours = Number(environment.REPLAY_CAPSULE_RETENTION_HOURS ?? 24);
  if (!Number.isFinite(retentionHours) || retentionHours <= 0) {
    throw new Error("REPLAY_CAPSULE_RETENTION_HOURS must be a positive number");
  }

  if (storeValue === "memory") {
    if (allowLivePromptRetention) {
      throw new Error("ALLOW_LIVE_PROMPT_RETENTION requires REPLAY_CAPSULE_STORE=postgres");
    }
    return {
      storeMode: "memory",
      allowLivePromptRetention,
      retentionMs: retentionHours * 60 * 60 * 1_000,
    };
  }

  if (!environment.DATABASE_URL) {
    throw new Error("REPLAY_CAPSULE_STORE=postgres requires DATABASE_URL");
  }
  const activeVersion = environment.REPLAY_CAPSULE_ACTIVE_KEY_VERSION;
  if (!activeVersion) {
    throw new Error("REPLAY_CAPSULE_STORE=postgres requires REPLAY_CAPSULE_ACTIVE_KEY_VERSION");
  }
  const keys = parseKeyring(environment.REPLAY_CAPSULE_KEYS_JSON);
  if (!keys.has(activeVersion)) {
    throw new Error("The active replay key version is not present in REPLAY_CAPSULE_KEYS_JSON");
  }
  return {
    storeMode: "postgres",
    allowLivePromptRetention,
    retentionMs: retentionHours * 60 * 60 * 1_000,
    keyring: { activeVersion, keys },
  };
}

function parseKeyring(value: string | undefined): ReadonlyMap<string, Buffer> {
  if (!value) {
    throw new Error("REPLAY_CAPSULE_STORE=postgres requires REPLAY_CAPSULE_KEYS_JSON");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("REPLAY_CAPSULE_KEYS_JSON must be valid JSON");
  }
  if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
    throw new Error("REPLAY_CAPSULE_KEYS_JSON must be a non-empty object");
  }
  const keys = new Map<string, Buffer>();
  for (const [version, encoded] of Object.entries(parsed)) {
    if (!version || typeof encoded !== "string" || !isCanonicalBase64(encoded)) {
      throw new Error("Each replay key must be a named base64-encoded value");
    }
    const key = Buffer.from(encoded, "base64");
    assertReplayKey(key);
    keys.set(version, key);
  }
  return keys;
}

function isCanonicalBase64(value: string): boolean {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, "base64").toString("base64") === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
