import type { ProviderRequest, ProviderResponse } from "@reliability-lab/contracts";
import type { LlmProvider, ProviderExecutionOptions, ProviderResult } from "./types.js";

const DEFAULT_MAX_RESPONSE_BYTES = 1_000_000;

export interface OpenAICompatibleOptions {
  id?: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImplementation?: typeof fetch;
  maxResponseBytes?: number;
}

/**
 * Generic Chat Completions transport for OpenAI-compatible providers.
 * Provider-specific errors and bodies are normalized before crossing this boundary.
 */
export class OpenAICompatibleHttpProvider implements LlmProvider {
  readonly id: string;
  readonly kind = "live" as const;
  readonly capability;
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #fetch: typeof fetch;
  readonly #maxResponseBytes: number;

  constructor(options: OpenAICompatibleOptions) {
    this.id = options.id ?? "openai-compatible";
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.capability = {
      id: this.id,
      kind: "live" as const,
      modelLabel: options.model,
      transportFamily: "openai_compatible_chat_completions" as const,
      configured: true,
      supportsFailureInjection: false,
      operatorEligible: true,
    };
  }

  async execute(
    request: ProviderRequest,
    options: ProviderExecutionOptions,
  ): Promise<ProviderResult> {
    const started = performance.now();
    if (request.model !== this.#model || request.failureMode !== undefined) {
      return {
        ok: false,
        latencyMs: 0,
        error: {
          category: "invalid_request",
          code: "live_provider_request_not_allowed",
          message: "The live provider request does not match its server configuration",
          retryable: false,
        },
      };
    }

    const timeoutSignal = AbortSignal.timeout(options.timeoutMs);
    const signal = AbortSignal.any([options.signal, timeoutSignal]);
    try {
      const response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          messages: request.messages ?? [{ role: "user", content: request.input }],
          ...(request.structuredOutputSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "reliability_lab_output",
                    strict: true,
                    schema: request.structuredOutputSchema,
                  },
                },
              }
            : {}),
          store: false,
        }),
        signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (!response.ok) {
        return {
          ok: false,
          latencyMs,
          error: normalizedHttpError(response.status),
        };
      }

      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > this.#maxResponseBytes) {
        return responseTooLarge(latencyMs);
      }
      const bytes = await readBoundedBody(response, this.#maxResponseBytes);
      if (!bytes) return responseTooLarge(latencyMs);

      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return malformedPayload(latencyMs);
      }
      const parsed = parseCompatibleResponse(payload);
      if (!parsed) return malformedPayload(latencyMs);
      return {
        ok: true,
        response: { ...parsed, provider: this.id, model: this.#model, latencyMs },
      };
    } catch {
      const latencyMs = Math.round(performance.now() - started);
      return {
        ok: false,
        latencyMs,
        error: {
          category: signal.aborted ? "timeout" : "unknown",
          code: signal.aborted ? "provider_timeout" : "provider_fetch_failed",
          message: "Provider request could not be completed",
          retryable: true,
        },
      };
    }
  }
}

function normalizedHttpError(status: number) {
  return {
    category:
      status === 429
        ? ("rate_limit" as const)
        : status >= 500
          ? ("provider_unavailable" as const)
          : status === 401 || status === 403
            ? ("authentication" as const)
            : ("invalid_request" as const),
    code: `http_${status}`,
    message: `Provider request failed with HTTP ${status}`,
    retryable: status === 429 || status >= 500,
    httpStatus: status,
  };
}

function malformedPayload(latencyMs: number): ProviderResult {
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

function responseTooLarge(latencyMs: number): ProviderResult {
  return {
    ok: false,
    latencyMs,
    error: {
      category: "malformed_response",
      code: "provider_response_too_large",
      message: "Provider response exceeded the configured size limit",
      retryable: false,
    },
  };
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
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
