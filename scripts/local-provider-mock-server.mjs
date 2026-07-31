import { createServer } from "node:http";

const apiKey = "local-playwright-provider-key";
const model = "local-playwright-model";
let requestCount = 0;

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.method === "GET" && request.url === "/stats") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ requestCount }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    response.writeHead(404).end();
    return;
  }

  requestCount += 1;
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    request.headers.authorization !== `Bearer ${apiKey}` ||
    body.model !== model ||
    body.store !== false ||
    !Array.isArray(body.messages)
  ) {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "invalid_local_wire_request" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      choices: [{ message: { content: "LOCAL_PLAYWRIGHT_PROVIDER_OK" } }],
      usage: { prompt_tokens: 9, completion_tokens: 5 },
    }),
  );
});

server.listen(4010, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
