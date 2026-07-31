import { createServer } from "node:http";
import { runBuiltApiProviderProof } from "./provider-proof-runtime.mjs";

const apiKey = "local-wire-proof-key";
const model = "local-wire-proof-model";
let requestCount = 0;
let mockFailure;
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
      body.messages?.[0]?.content?.startsWith("Local wire provider proof ") !== true
    ) {
      throw new Error("Unexpected local provider request body");
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: "LOCAL_WIRE_PROOF_OK" } }],
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
  const result = await runBuiltApiProviderProof({
    providerBaseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey,
    model,
    timeoutMs: 5_000,
    input: (identity) => `Local wire provider proof ${identity}`,
  });
  if (mockFailure) throw mockFailure;
  if (requestCount !== 1)
    throw new Error(`Expected one local provider request; saw ${requestCount}`);
  if (result.status !== "succeeded" || result.replayState !== "retention_disabled") {
    throw new Error("Local wire proof did not produce the expected normalized execution");
  }
  process.stdout.write(
    `Local wire-compatible provider proof: passed (built API, ordinary execution, ${requestCount} mock request, replay ${result.replayState}).\n`,
  );
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
