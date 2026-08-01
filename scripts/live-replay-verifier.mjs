const requiredSettings = [
  "OPENAI_COMPATIBLE_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "DATABASE_URL",
  "REPLAY_CAPSULE_ACTIVE_KEY_VERSION",
  "REPLAY_CAPSULE_KEYS_JSON",
];
const safeLabel = /^[A-Za-z0-9._:/-]{1,128}$/u;
const safeId = /^[A-Za-z0-9_-]{1,200}$/u;

export async function runLiveReplayVerifier({ environment, runProof, writeOutput, writeError }) {
  if (environment.RUN_LIVE_REPLAY_VERIFY !== "true") {
    writeOutput(
      "External encrypted live replay proof: not run (RUN_LIVE_REPLAY_VERIFY is not true; no request was made).\n",
    );
    return 0;
  }
  const missing = requiredSettings.filter((name) => !environment[name]?.trim());
  if (
    environment.REPLAY_CAPSULE_STORE !== "postgres" ||
    environment.ALLOW_LIVE_PROMPT_RETENTION !== "true"
  ) {
    missing.push("REPLAY_CAPSULE_STORE=postgres", "ALLOW_LIVE_PROMPT_RETENTION=true");
  }
  if (missing.length > 0) {
    writeError(
      `External encrypted live replay proof: not run; missing required settings: ${missing.join(", ")}. No request was made.\n`,
    );
    return 1;
  }
  try {
    const result = validateResult(
      await runProof({
        providerBaseUrl: environment.OPENAI_COMPATIBLE_BASE_URL.trim(),
        apiKey: environment.OPENAI_API_KEY.trim(),
        model: environment.OPENAI_MODEL.trim(),
        databaseUrl: environment.DATABASE_URL.trim(),
        activeKeyVersion: environment.REPLAY_CAPSULE_ACTIVE_KEY_VERSION.trim(),
        keysJson: environment.REPLAY_CAPSULE_KEYS_JSON.trim(),
        retentionHours: environment.REPLAY_CAPSULE_RETENTION_HOURS?.trim() || "24",
        timeoutMs: 20_000,
        input: (identity) =>
          `Reliability Lab encrypted live replay proof ${identity}. Reply with LIVE_REPLAY_PROOF_OK.`,
      }),
    );
    writeOutput(`External encrypted live replay proof: succeeded (${formatResult(result)}).\n`);
    writeOutput(
      "This proves two-call connectivity and replay wiring only; it does not establish reliability, model quality, or production readiness.\n",
    );
    return 0;
  } catch {
    writeError(
      "External encrypted live replay proof: failed safely; no input, output, endpoint, key, credential, raw body, or capsule content was printed.\n",
    );
    return 1;
  }
}

function validateResult(value) {
  if (!value || typeof value !== "object") throw new Error("Malformed proof result");
  for (const key of ["providerId", "modelLabel"]) {
    if (typeof value[key] !== "string" || !safeLabel.test(value[key])) {
      throw new Error("Unsafe proof metadata");
    }
  }
  for (const key of ["originalExecutionId", "replayExecutionId"]) {
    if (typeof value[key] !== "string" || !safeId.test(value[key])) {
      throw new Error("Unsafe execution identifier");
    }
  }
  if (
    value.originalExecutionId === value.replayExecutionId ||
    value.originalStatus !== "succeeded" ||
    value.replayStatus !== "succeeded" ||
    value.externalRequestCount !== 2
  ) {
    throw new Error("Live replay proof invariant failed");
  }
  return value;
}

function formatResult(result) {
  return [
    ["providerId", result.providerId],
    ["model", result.modelLabel],
    ["originalStatus", result.originalStatus],
    ["replayStatus", result.replayStatus],
    ["originalExecutionId", result.originalExecutionId],
    ["replayExecutionId", result.replayExecutionId],
    ["originalLatencyMs", result.originalLatencyMs],
    ["replayLatencyMs", result.replayLatencyMs],
    ["inputTokens", result.inputTokens],
    ["outputTokens", result.outputTokens],
    ["externalRequestCount", result.externalRequestCount],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join(", ");
}
