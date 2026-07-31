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
    const execution = await waitForTerminal(apiBaseUrl, submission.executionId);
    if (execution.attempts?.length !== 1) {
      throw new Error("The proof did not produce exactly one provider attempt");
    }
    return {
      providerId: liveProvider.id,
      modelLabel: liveProvider.modelLabel,
      executionId: execution.executionId,
      status: execution.status,
      attemptCount: execution.attempts.length,
      replayState: execution.replayCapability?.state,
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

async function waitForTerminal(apiBaseUrl, executionId) {
  const deadline = Date.now() + 35_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${apiBaseUrl}/v1/executions/${encodeURIComponent(executionId)}`, {
      headers: { "x-tenant-id": tenantId },
    });
    if (!response.ok) throw new Error("Execution detail read failed");
    const execution = await response.json();
    if (["succeeded", "degraded", "failed", "cancelled"].includes(execution.status)) {
      return execution;
    }
    await delay(50);
  }
  throw new Error("Provider proof execution did not become terminal");
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
