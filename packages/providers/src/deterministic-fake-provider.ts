import type { FailureMode, ProviderError, ProviderRequest } from "@reliability-lab/contracts";
import type { LlmProvider, ProviderExecutionOptions, ProviderResult } from "./types.js";

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
  readonly capability;
  readonly #fixture: FakeProviderFixture;
  readonly #seed: number;
  #calls = 0;

  constructor(options: FakeProviderOptions) {
    this.id = options.id;
    this.capability = {
      id: options.id,
      kind: "deterministic" as const,
      modelLabel: "deterministic-v1",
      transportFamily: "in_process_fixture" as const,
      configured: true,
      supportsFailureInjection: true,
      operatorEligible: true,
    };
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
