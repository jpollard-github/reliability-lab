import { describe, expect, it, vi } from "vitest";
import { OpenAICompatibleHttpProvider } from "../src/openai-compatible-http-provider.js";

const apiKey = "test-secret-key";
const request = {
  executionId: "execution-1",
  tenantId: "tenant-a",
  provider: "openai-compatible",
  model: "safe-model",
  input: "small safe input",
  attempt: 1,
} as const;

function provider(fetchImplementation: typeof fetch, maxResponseBytes?: number) {
  return new OpenAICompatibleHttpProvider({
    baseUrl: "https://provider.example/v1/",
    apiKey,
    model: "safe-model",
    fetchImplementation,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
  });
}

function completion(content = '{"result":"ok"}') {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("OpenAICompatibleHttpProvider", () => {
  it("sends the configured endpoint, authorization, model, and input", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(completion());
    const result = await provider(fetchImplementation).execute(request, {
      signal: new AbortController().signal,
      timeoutMs: 1_000,
    });

    expect(result.ok).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(init?.headers).toEqual({
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "safe-model",
      messages: [{ role: "user", content: "small safe input" }],
      store: false,
    });
  });

  it("preserves explicit messages and structured-output configuration", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(completion());
    const { input: _input, ...requestWithoutInput } = request;
    await provider(fetchImplementation).execute(
      {
        ...requestWithoutInput,
        messages: [
          { role: "system", content: "Return JSON." },
          { role: "user", content: "Classify this." },
        ],
        structuredOutputSchema: {
          type: "object",
          properties: { result: { type: "string" } },
          required: ["result"],
          additionalProperties: false,
        },
      },
      { signal: new AbortController().signal, timeoutMs: 1_000 },
    );
    const body = JSON.parse(String(fetchImplementation.mock.calls[0]![1]?.body));
    expect(body.messages).toHaveLength(2);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "reliability_lab_output",
        strict: true,
        schema: {
          type: "object",
          properties: { result: { type: "string" } },
          required: ["result"],
          additionalProperties: false,
        },
      },
    });
  });

  it("parses JSON output and normalized usage", async () => {
    const result = await provider(vi.fn<typeof fetch>().mockResolvedValue(completion())).execute(
      request,
      { signal: new AbortController().signal, timeoutMs: 1_000 },
    );
    expect(result).toMatchObject({
      ok: true,
      response: {
        provider: "openai-compatible",
        model: "safe-model",
        outputText: '{"result":"ok"}',
        outputJson: { result: "ok" },
        usage: { inputTokens: 11, outputTokens: 7 },
      },
    });
  });

  it("accepts non-JSON model text without inventing structured output", async () => {
    const result = await provider(
      vi.fn<typeof fetch>().mockResolvedValue(completion("plain response")),
    ).execute(request, { signal: new AbortController().signal, timeoutMs: 1_000 });
    expect(result).toMatchObject({
      ok: true,
      response: { outputText: "plain response" },
    });
    if (result.ok) expect(result.response.outputJson).toBeUndefined();
  });

  it.each([
    [400, "invalid_request", false],
    [401, "authentication", false],
    [429, "rate_limit", true],
    [500, "provider_unavailable", true],
    [503, "provider_unavailable", true],
  ] as const)(
    "normalizes HTTP %s without exposing its response body",
    async (status, category, retryable) => {
      const result = await provider(
        vi.fn<typeof fetch>().mockResolvedValue(new Response(`raw secret ${apiKey}`, { status })),
      ).execute(request, { signal: new AbortController().signal, timeoutMs: 1_000 });
      expect(result).toMatchObject({
        ok: false,
        error: { category, code: `http_${status}`, retryable, httpStatus: status },
      });
      expect(JSON.stringify(result)).not.toContain(apiKey);
      expect(JSON.stringify(result)).not.toContain("raw secret");
    },
  );

  it.each([
    new Response("not JSON", { status: 200 }),
    new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    new Response(JSON.stringify({ choices: [{ message: {} }] }), { status: 200 }),
  ])("normalizes malformed successful payloads", async (response) => {
    const result = await provider(vi.fn<typeof fetch>().mockResolvedValue(response)).execute(
      request,
      { signal: new AbortController().signal, timeoutMs: 1_000 },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { category: "malformed_response", code: "invalid_provider_payload" },
    });
  });

  it("normalizes network failures without leaking exception text", async () => {
    const result = await provider(
      vi.fn<typeof fetch>().mockRejectedValue(new Error(`socket ${apiKey}`)),
    ).execute(request, { signal: new AbortController().signal, timeoutMs: 1_000 });
    expect(result).toMatchObject({
      ok: false,
      error: { category: "unknown", code: "provider_fetch_failed", retryable: true },
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("normalizes caller abort and adapter timeout", async () => {
    const waitForAbort = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const controller = new AbortController();
    controller.abort();
    const aborted = await provider(
      vi.fn<typeof fetch>().mockRejectedValue(new Error("aborted")),
    ).execute(request, { signal: controller.signal, timeoutMs: 1_000 });
    const timedOut = await provider(waitForAbort).execute(request, {
      signal: new AbortController().signal,
      timeoutMs: 1,
    });
    expect(aborted).toMatchObject({ ok: false, error: { category: "timeout" } });
    expect(timedOut).toMatchObject({
      ok: false,
      error: { category: "timeout", code: "provider_timeout" },
    });
  });

  it("rejects configured-model mismatch and failure injection before fetch", async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const modelMismatch = await provider(fetchImplementation).execute(
      { ...request, model: "browser-selected-model" },
      { signal: new AbortController().signal, timeoutMs: 1_000 },
    );
    const injectedFailure = await provider(fetchImplementation).execute(
      { ...request, failureMode: "rate_limit" },
      { signal: new AbortController().signal, timeoutMs: 1_000 },
    );
    expect(modelMismatch).toMatchObject({
      ok: false,
      error: { code: "live_provider_request_not_allowed" },
    });
    expect(injectedFailure).toMatchObject({
      ok: false,
      error: { code: "live_provider_request_not_allowed" },
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("bounds declared and actual response size", async () => {
    const declared = await provider(
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("{}", { status: 200, headers: { "content-length": "101" } }),
        ),
      100,
    ).execute(request, { signal: new AbortController().signal, timeoutMs: 1_000 });
    const actual = await provider(
      vi.fn<typeof fetch>().mockResolvedValue(completion("x".repeat(200))),
      100,
    ).execute(request, { signal: new AbortController().signal, timeoutMs: 1_000 });
    expect(declared).toMatchObject({
      ok: false,
      error: { code: "provider_response_too_large" },
    });
    expect(actual).toMatchObject({
      ok: false,
      error: { code: "provider_response_too_large" },
    });
  });
});
