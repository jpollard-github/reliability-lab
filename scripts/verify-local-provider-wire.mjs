import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { runBuiltApiEncryptedReplayComparisonProof } from "./provider-proof-runtime.mjs";

const apiKey = "local-encrypted-wire-proof-key";
const model = "local-encrypted-wire-proof-model";
const tenantId = `local-wire-${randomUUID()}`;
const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://reliability:reliability@127.0.0.1:5432/reliability_lab";
const key = randomBytes(32).toString("base64");
let apiBaseUrl;
let requestCount = 0;
let mockFailure;
const persistenceChecks = [];

const server = createServer(async (request, response) => {
  try {
    requestCount += 1;
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      throw new Error("Unexpected local provider route");
    }
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      throw new Error("Unexpected local provider authorization");
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (
      body.model !== model ||
      body.store !== false ||
      body.messages?.[0]?.content?.startsWith("Local encrypted replay wire proof ") !== true
    ) {
      throw new Error("Unexpected local provider request body");
    }
    if (!apiBaseUrl) throw new Error("Built API location was unavailable");
    const executionsResponse = await fetch(`${apiBaseUrl}/v1/executions`, {
      headers: { "x-tenant-id": tenantId },
    });
    const executions = await executionsResponse.json();
    const available = executions.data?.filter(
      (execution) => execution.replayCapability?.state === "available",
    );
    const running = executions.data?.some(
      (execution) =>
        execution.status === "running" &&
        execution.attempts?.some((attempt) => attempt.status === "running"),
    );
    const persistedBeforeProvider =
      executionsResponse.ok && available?.length === requestCount && running === true;
    persistenceChecks.push(persistedBeforeProvider);
    if (!persistedBeforeProvider) {
      throw new Error("Encrypted capsule was not durably visible before provider execution");
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: "LOCAL_ENCRYPTED_REPLAY_PROOF_OK" } }],
        usage: { prompt_tokens: 8, completion_tokens: 4 },
      }),
    );
  } catch (error) {
    mockFailure = error;
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "local_mock_rejected_request" }));
  }
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local provider did not bind");
  const result = await runBuiltApiEncryptedReplayComparisonProof({
    providerBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey,
    model,
    databaseUrl,
    activeKeyVersion: "local-wire-v1",
    keysJson: JSON.stringify({ "local-wire-v1": key }),
    tenantId,
    timeoutMs: 5_000,
    input: (identity) => `Local encrypted replay wire proof ${identity}`,
    onApiReady: (value) => {
      apiBaseUrl = value;
    },
  });
  if (mockFailure) throw mockFailure;
  if (
    requestCount !== 3 ||
    result.externalRequestCount !== 3 ||
    persistenceChecks.length !== 3 ||
    persistenceChecks.some((value) => !value)
  ) {
    throw new Error("Local encrypted replay request-count invariant failed");
  }
  process.stdout.write(
    "Local encrypted live replay proof: passed (PostgreSQL vault, 3 mock requests: original + replay + bounded variant; all capsules visible before provider calls; original deletion blocked future effects; normalized evidence preserved).\n",
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
