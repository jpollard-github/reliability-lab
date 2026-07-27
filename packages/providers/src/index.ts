import type {
  FailureMode,
  ProviderError,
  ProviderRequest,
  ProviderResponse,
} from "@reliability-lab/contracts";

export interface ProviderExecutionOptions {
  signal: AbortSignal;
  timeoutMs: number;
}

export type ProviderResult =
  { ok: true; response: ProviderResponse } | { ok: false; error: ProviderError; latencyMs: number };

export interface LlmProvider {
  readonly id: string;
  readonly kind: "fake" | "live";
  execute(request: ProviderRequest, options: ProviderExecutionOptions): Promise<ProviderResult>;
}

export interface FakeProviderFixture {
  failuresBeforeSuccess?: number;
  responseText?: string;
  responseJson?: unknown;
  latencyMs?: number;
}

export interface FakeProviderOptions {
  id: string;
  seed?: number;
  fixture?: FakeProviderFixture;
  now?: () => number;
}

const failure = (mode: FailureMode): ProviderError => {
  switch (mode) {
    case "timeout":
    case "latency":
      return {
        category: "timeout",
        code: `fake_${mode}`,
        message: mode === "latency" ? "Latency budget exceeded" : "Provider timed out",
        retryable: true,
      };
    case "rate_limit":
      return {
        category: "rate_limit",
        code: "fake_rate_limit",
        message: "Provider rate limit reached",
        retryable: true,
        httpStatus: 429,
      };
    case "provider_error":
      return {
        category: "provider_unavailable",
        code: "fake_provider_error",
        message: "Provider unavailable",
        retryable: true,
        httpStatus: 503,
      };
    case "malformed_json":
      return {
        category: "malformed_response",
        code: "fake_malformed_json",
        message: "Provider returned malformed structured output",
        retryable: false,
      };
  }
};

export class DeterministicFakeProvider implements LlmProvider {
  readonly kind = "fake" as const;
  readonly id: string;
  readonly #fixture: FakeProviderFixture;
  readonly #seed: number;
  #calls = 0;

  constructor(options: FakeProviderOptions) {
    this.id = options.id;
    this.#fixture = options.fixture ?? {};
    this.#seed = options.seed ?? 17;
  }

  async execute(
    request: ProviderRequest,
    options: ProviderExecutionOptions,
  ): Promise<ProviderResult> {
    this.#calls += 1;
    if (options.signal.aborted) {
      return {
        ok: false,
        error: {
          category: "timeout",
          code: "aborted",
          message: "Request aborted",
          retryable: true,
        },
        latencyMs: 0,
      };
    }

    const configuredFailures = this.#fixture.failuresBeforeSuccess;
    const shouldForceFailure =
      configuredFailures === undefined
        ? request.failureMode === "rate_limit"
          ? request.attempt === 1
          : request.failureMode !== undefined
        : this.#calls <= configuredFailures;
    const mode = shouldForceFailure ? (request.failureMode ?? "provider_error") : undefined;
    if (mode && mode !== "malformed_json") {
      return { ok: false, error: failure(mode), latencyMs: this.#fixture.latencyMs ?? 1 };
    }

    const input =
      request.input ?? request.messages?.map((message) => message.content).join(" ") ?? "";
    const outputJson =
      mode === "malformed_json"
        ? undefined
        : (this.#fixture.responseJson ?? { result: `deterministic:${input.length}:${this.#seed}` });
    const outputText =
      mode === "malformed_json"
        ? "{this is not json"
        : (this.#fixture.responseText ?? JSON.stringify(outputJson));

    return {
      ok: true,
      response: {
        provider: this.id,
        model: request.model,
        outputText,
        outputJson,
        latencyMs: this.#fixture.latencyMs ?? 1,
        usage: {
          inputTokens: Math.max(1, Math.ceil(input.length / 4)),
          outputTokens: Math.max(1, Math.ceil(outputText.length / 4)),
          estimatedCostUsd: 0,
        },
      },
    };
  }
}

export interface OpenAICompatibleOptions {
  id?: string;
  baseUrl: string;
  apiKey: string;
  fetchImplementation?: typeof fetch;
}

export class OpenAICompatibleHttpProvider implements LlmProvider {
  readonly id: string;
  readonly kind = "live" as const;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id ?? "openai-compatible";
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async execute(
    request: ProviderRequest,
    options: ProviderExecutionOptions,
  ): Promise<ProviderResult> {
    const started = performance.now();
    try {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages ?? [{ role: "user", content: request.input }],
          ...(request.structuredOutputSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "reliability_lab_output",
                    schema: request.structuredOutputSchema,
                  },
                },
              }
            : {}),
        }),
        signal: options.signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          error: {
            category:
              response.status === 429
                ? "rate_limit"
                : response.status >= 500
                  ? "provider_unavailable"
                  : response.status === 401
                    ? "authentication"
                    : "invalid_request",
            code: `http_${response.status}`,
            message: `Provider request failed with HTTP ${response.status}`,
            retryable: response.status === 429 || response.status >= 500,
            httpStatus: response.status,
          },
        };
      }

      const payload: unknown = await response.json();
      const parsed = parseCompatibleResponse(payload);
      if (!parsed) {
        return {
          ok: false,
          latencyMs,
          error: {
            category: "malformed_response",
            code: "invalid_provider_payload",
            message: "Provider response did not match the supported response shape",
            retryable: false,
          },
        };
      }
      return {
        ok: true,
        response: { ...parsed, provider: this.id, model: request.model, latencyMs },
      };
    } catch (caught) {
      const latencyMs = Math.round(performance.now() - started);
      return {
        ok: false,
        latencyMs,
        error: {
          category:
            caught instanceof DOMException && caught.name === "AbortError" ? "timeout" : "unknown",
          code: "provider_fetch_failed",
          message: "Provider request could not be completed",
          retryable: true,
        },
      };
    }
  }
}

function parseCompatibleResponse(
  value: unknown,
): Omit<ProviderResponse, "provider" | "model" | "latencyMs"> | null {
  if (!isRecord(value) || !Array.isArray(value.choices)) return null;
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message) || typeof first.message.content !== "string")
    return null;
  const usage = isRecord(value.usage) ? value.usage : {};
  const outputText = first.message.content;
  let outputJson: unknown;
  try {
    outputJson = JSON.parse(outputText);
  } catch {
    outputJson = undefined;
  }
  return {
    outputText,
    ...(outputJson === undefined ? {} : { outputJson }),
    usage: {
      inputTokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      outputTokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
