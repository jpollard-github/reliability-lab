import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const tenantId = "provider-proof-tenant";

export async function runBuiltApiProviderProof(options) {
  await access(new URL("../apps/api/dist/server.js", import.meta.url));
  const apiPort = await availablePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: "",
      REDIS_URL: "",
      EXECUTION_MODE: "in_process",
      REPLAY_CAPSULE_STORE: "memory",
      ALLOW_LIVE_PROMPT_RETENTION: "false",
      ENABLE_FAILURE_INJECTION: "false",
      API_PORT: String(apiPort),
      OPENAI_COMPATIBLE_BASE_URL: options.providerBaseUrl,
      OPENAI_API_KEY: options.apiKey,
      OPENAI_MODEL: options.model,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    await waitForApi(apiBaseUrl, child);
    const capabilitiesResponse = await fetch(`${apiBaseUrl}/v1/providers`, {
      headers: { "x-tenant-id": tenantId },
    });
    if (!capabilitiesResponse.ok) throw new Error("Provider capability read failed");
    const capabilities = await capabilitiesResponse.json();
    const liveProvider = capabilities.data?.find(
      (item) => item.kind === "live" && item.configured && item.operatorEligible,
    );
    if (!liveProvider || liveProvider.modelLabel !== options.model) {
      throw new Error("The live provider is not operator eligible");
    }

    const identity = randomUUID();
    const submitResponse = await fetch(`${apiBaseUrl}/v1/executions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
        "idempotency-key": `provider-proof-${identity}`,
      },
      body: JSON.stringify({
        provider: liveProvider.id,
        model: liveProvider.modelLabel,
        input: options.input(identity),
        policy: {
          maxAttempts: 1,
          baseBackoffMs: 0,
          maxBackoffMs: 0,
          jitterRatio: 0,
        },
        budget: { maxLatencyMs: options.timeoutMs },
      }),
    });
    if (submitResponse.status !== 202) {
      throw new Error(`Execution submission failed with HTTP ${submitResponse.status}`);
    }
    const submission = await submitResponse.json();
    if (!submission || typeof submission.executionId !== "string") {
      throw new Error("Execution submission response was malformed");
    }
    const execution = await waitForTerminal(apiBaseUrl, submission.executionId);
    if (execution.attempts?.length !== 1) {
      throw new Error("The proof did not produce exactly one provider attempt");
    }
    if (execution.status !== "succeeded") {
      throw new Error("The proof execution did not succeed");
    }
    const attempt = execution.attempts[0];
    const inputTokens = boundedMetric(attempt?.usage?.inputTokens, true);
    const outputTokens = boundedMetric(attempt?.usage?.outputTokens, true);
    return {
      providerId: liveProvider.id,
      modelLabel: liveProvider.modelLabel,
      executionId: execution.executionId,
      status: execution.status,
      externalRequestCount: execution.attempts.length,
      replayState: execution.replayCapability?.state,
      ...metric("totalLatencyMs", boundedMetric(execution.durationMs, false)),
      ...metric("providerLatencyMs", boundedMetric(attempt?.durationMs, false)),
      ...metric("inputTokens", inputTokens),
      ...metric("outputTokens", outputTokens),
      ...(inputTokens !== undefined && outputTokens !== undefined
        ? { totalTokens: inputTokens + outputTokens }
        : {}),
    };
  } finally {
    await stopChild(child);
  }
}

export async function runBuiltApiLiveReplayProof(options) {
  await access(new URL("../apps/api/dist/server.js", import.meta.url));
  const apiPort = await availablePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: options.databaseUrl,
      REDIS_URL: "",
      EXECUTION_MODE: "in_process",
      REPLAY_CAPSULE_STORE: "postgres",
      ALLOW_LIVE_PROMPT_RETENTION: "true",
      REPLAY_CAPSULE_RETENTION_HOURS: options.retentionHours,
      REPLAY_CAPSULE_ACTIVE_KEY_VERSION: options.activeKeyVersion,
      REPLAY_CAPSULE_KEYS_JSON: options.keysJson,
      ENABLE_FAILURE_INJECTION: "false",
      API_PORT: String(apiPort),
      OPENAI_COMPATIBLE_BASE_URL: options.providerBaseUrl,
      OPENAI_API_KEY: options.apiKey,
      OPENAI_MODEL: options.model,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    await waitForApi(apiBaseUrl, child);
    const capabilitiesResponse = await fetch(`${apiBaseUrl}/v1/providers`, {
      headers: { "x-tenant-id": tenantId },
    });
    if (!capabilitiesResponse.ok) throw new Error("Provider capability read failed");
    const capabilities = await capabilitiesResponse.json();
    const liveProvider = capabilities.data?.find(
      (item) => item.kind === "live" && item.configured && item.operatorEligible,
    );
    if (
      !liveProvider ||
      liveProvider.modelLabel !== options.model ||
      liveProvider.liveReplayRetention?.available !== true
    ) {
      throw new Error("Encrypted live replay is not operator eligible");
    }

    const identity = randomUUID();
    const submitResponse = await fetch(`${apiBaseUrl}/v1/executions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": tenantId,
        "idempotency-key": `live-replay-proof-${identity}`,
      },
      body: JSON.stringify({
        provider: liveProvider.id,
        model: liveProvider.modelLabel,
        input: options.input(identity),
        replayRetention: "encrypted",
        policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
        budget: { maxLatencyMs: options.timeoutMs },
      }),
    });
    if (submitResponse.status !== 202) {
      throw new Error(`Retained execution submission failed with HTTP ${submitResponse.status}`);
    }
    const submission = await submitResponse.json();
    const original = await waitForTerminal(apiBaseUrl, submission.executionId);
    if (original.status !== "succeeded" || original.replayCapability?.state !== "available") {
      throw new Error("Retained live execution did not succeed with replay available");
    }

    const replayResponse = await fetch(
      `${apiBaseUrl}/v1/executions/${encodeURIComponent(original.executionId)}/replay`,
      { method: "POST", headers: { "x-tenant-id": tenantId } },
    );
    if (replayResponse.status !== 202) {
      throw new Error(`Replay submission failed with HTTP ${replayResponse.status}`);
    }
    const replayResult = await replayResponse.json();
    const replayExecutionId = replayResult.replayExecution?.executionId;
    if (typeof replayExecutionId !== "string" || replayExecutionId === original.executionId) {
      throw new Error("Replay execution linkage was malformed");
    }
    const replay = await waitForTerminal(apiBaseUrl, replayExecutionId);
    if (
      replay.status !== "succeeded" ||
      replay.replayOfExecutionId !== original.executionId ||
      replay.replayCapability?.state !== "available"
    ) {
      throw new Error("Replay execution did not succeed with independent retention");
    }
    const externalRequestCount = (original.attempts?.length ?? 0) + (replay.attempts?.length ?? 0);
    if (externalRequestCount !== 2) throw new Error("Unexpected external request count");
    return {
      providerId: liveProvider.id,
      modelLabel: liveProvider.modelLabel,
      originalExecutionId: original.executionId,
      replayExecutionId: replay.executionId,
      originalStatus: original.status,
      replayStatus: replay.status,
      externalRequestCount,
      ...metric("originalLatencyMs", boundedMetric(original.durationMs, false)),
      ...metric("replayLatencyMs", boundedMetric(replay.durationMs, false)),
      ...metric(
        "inputTokens",
        boundedMetric(
          (original.attempts?.[0]?.usage?.inputTokens ?? 0) +
            (replay.attempts?.[0]?.usage?.inputTokens ?? 0),
          true,
        ),
      ),
      ...metric(
        "outputTokens",
        boundedMetric(
          (original.attempts?.[0]?.usage?.outputTokens ?? 0) +
            (replay.attempts?.[0]?.usage?.outputTokens ?? 0),
          true,
        ),
      ),
    };
  } finally {
    await stopChild(child);
  }
}

export async function runBuiltApiEncryptedReplayComparisonProof(options) {
  await access(new URL("../apps/api/dist/server.js", import.meta.url));
  const apiPort = await availablePort();
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const proofTenantId = options.tenantId;
  const child = spawn(process.execPath, ["apps/api/dist/server.js"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      DATABASE_URL: options.databaseUrl,
      REDIS_URL: "",
      EXECUTION_MODE: "in_process",
      REPLAY_CAPSULE_STORE: "postgres",
      ALLOW_LIVE_PROMPT_RETENTION: "true",
      REPLAY_CAPSULE_RETENTION_HOURS: "24",
      REPLAY_CAPSULE_ACTIVE_KEY_VERSION: options.activeKeyVersion,
      REPLAY_CAPSULE_KEYS_JSON: options.keysJson,
      ENABLE_FAILURE_INJECTION: "false",
      API_PORT: String(apiPort),
      OPENAI_COMPATIBLE_BASE_URL: options.providerBaseUrl,
      OPENAI_API_KEY: options.apiKey,
      OPENAI_MODEL: options.model,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});

  try {
    await waitForApi(apiBaseUrl, child);
    options.onApiReady?.(apiBaseUrl);
    const headers = { "x-tenant-id": proofTenantId };
    const capabilitiesResponse = await fetch(`${apiBaseUrl}/v1/providers`, { headers });
    const capabilities = await capabilitiesResponse.json();
    const liveProvider = capabilities.data?.find(
      (item) => item.kind === "live" && item.configured && item.operatorEligible,
    );
    if (
      !capabilitiesResponse.ok ||
      !liveProvider ||
      liveProvider.liveReplayRetention?.available !== true ||
      liveProvider.liveReplayRetention?.perExecutionOptInRequired !== true
    ) {
      throw new Error("Encrypted live replay capability was unavailable");
    }

    const identity = randomUUID();
    const createResponse = await fetch(`${apiBaseUrl}/v1/executions`, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "idempotency-key": `encrypted-wire-${identity}`,
      },
      body: JSON.stringify({
        provider: liveProvider.id,
        model: liveProvider.modelLabel,
        input: options.input(identity),
        replayRetention: "encrypted",
        policy: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
        budget: { maxLatencyMs: options.timeoutMs },
      }),
    });
    if (createResponse.status !== 202) throw new Error("Retained execution was not accepted");
    const created = await createResponse.json();
    const original = await waitForTerminal(apiBaseUrl, created.executionId, proofTenantId);
    if (original.status !== "succeeded" || original.replayCapability?.state !== "available") {
      throw new Error("Original retained execution invariant failed");
    }
    const originalEvidence = safeExecutionEvidence(original);

    const replayResponse = await fetch(
      `${apiBaseUrl}/v1/executions/${encodeURIComponent(original.executionId)}/replay`,
      { method: "POST", headers },
    );
    if (replayResponse.status !== 202) throw new Error("Replay was not accepted");
    const replayResult = await replayResponse.json();
    const replay = await waitForTerminal(
      apiBaseUrl,
      replayResult.replayExecution?.executionId,
      proofTenantId,
    );
    if (
      replay.status !== "succeeded" ||
      replay.replayOfExecutionId !== original.executionId ||
      replay.replayCapability?.state !== "available"
    ) {
      throw new Error("Replay invariant failed");
    }

    const comparisonResponse = await fetch(
      `${apiBaseUrl}/v1/executions/${encodeURIComponent(original.executionId)}/comparisons`,
      {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          variation: { budget: { maxLatencyMs: Math.max(1, options.timeoutMs - 1) } },
        }),
      },
    );
    if (comparisonResponse.status !== 202) throw new Error("Comparison was not accepted");
    const comparisonSubmission = await comparisonResponse.json();
    const variantExecutionId = comparisonSubmission.experiment?.variantExecutionId;
    const experimentId = comparisonSubmission.experiment?.experimentId;
    const variant = await waitForTerminal(apiBaseUrl, variantExecutionId, proofTenantId);
    if (
      variant.status !== "succeeded" ||
      variant.replayOfExecutionId !== original.executionId ||
      variant.replayCapability?.state !== "available"
    ) {
      throw new Error("Comparison variant invariant failed");
    }
    if (new Set([original.executionId, replay.executionId, variant.executionId]).size !== 3) {
      throw new Error("Execution identities were not distinct");
    }
    const originalAfterChildren = await readExecution(
      apiBaseUrl,
      original.executionId,
      proofTenantId,
    );
    if (
      JSON.stringify(safeExecutionEvidence(originalAfterChildren)) !==
      JSON.stringify(originalEvidence)
    ) {
      throw new Error("Original normalized evidence changed after replay or comparison");
    }

    const deleteResponse = await fetch(
      `${apiBaseUrl}/v1/executions/${encodeURIComponent(original.executionId)}/replay-capsule`,
      { method: "DELETE", headers },
    );
    if (!deleteResponse.ok || (await deleteResponse.json()).replayCapability?.state !== "deleted") {
      throw new Error("Original capsule deletion failed");
    }
    const replayAfterDelete = await fetch(
      `${apiBaseUrl}/v1/executions/${encodeURIComponent(original.executionId)}/replay`,
      { method: "POST", headers },
    );
    if (replayAfterDelete.status !== 409) throw new Error("Deleted replay remained available");
    const comparisonView = await fetch(
      `${apiBaseUrl}/v1/comparisons/${encodeURIComponent(experimentId)}`,
      { headers },
    );
    if (!comparisonView.ok || (await comparisonView.json()).experiment?.status !== "completed") {
      throw new Error("Comparison evidence was not preserved after deletion");
    }

    const externalRequestCount =
      original.attempts.length + replay.attempts.length + variant.attempts.length;
    if (externalRequestCount !== 3) throw new Error("Unexpected local provider request count");
    return {
      originalExecutionId: original.executionId,
      replayExecutionId: replay.executionId,
      variantExecutionId: variant.executionId,
      experimentId,
      externalRequestCount,
      replayStateAfterDelete: "deleted",
      evidencePreserved: true,
    };
  } finally {
    await stopChild(child);
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitForApi(apiBaseUrl, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Built API exited before becoming healthy");
    try {
      const response = await fetch(`${apiBaseUrl}/healthz`);
      if (response.ok) return;
    } catch {
      // The child may still be binding its loopback listener.
    }
    await delay(50);
  }
  throw new Error("Built API did not become healthy within 10 seconds");
}

async function waitForTerminal(apiBaseUrl, executionId, executionTenantId = tenantId) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/v1/executions/${encodeURIComponent(executionId)}`, {
      headers: { "x-tenant-id": executionTenantId },
    });
    if (!response.ok) throw new Error("Execution detail read failed");
    const execution = await response.json();
    if (!execution || typeof execution !== "object" || typeof execution.status !== "string") {
      throw new Error("Execution detail response was malformed");
    }
    if (
      ["succeeded", "degraded", "failed", "cancelled", "rejected", "timed_out"].includes(
        execution.status,
      )
    ) {
      return execution;
    }
    if (!["queued", "running"].includes(execution.status)) {
      throw new Error("Execution detail response had an unknown status");
    }
    await delay(50);
  }
  throw new Error("Provider proof execution did not become terminal");
}

async function readExecution(apiBaseUrl, executionId, executionTenantId) {
  const response = await fetch(`${apiBaseUrl}/v1/executions/${encodeURIComponent(executionId)}`, {
    headers: { "x-tenant-id": executionTenantId },
  });
  if (!response.ok) throw new Error("Execution detail read failed");
  return response.json();
}

function safeExecutionEvidence(execution) {
  return {
    executionId: execution.executionId,
    status: execution.status,
    provider: execution.provider,
    model: execution.model,
    policy: execution.policy,
    budget: execution.budget,
    attempts: execution.attempts,
    events: execution.events,
    requestHash: execution.requestHash,
  };
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function boundedMetric(value, integer) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1_000_000_000 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new Error("Execution metric was malformed");
  }
  return value;
}

function metric(name, value) {
  return value === undefined ? {} : { [name]: value };
}
