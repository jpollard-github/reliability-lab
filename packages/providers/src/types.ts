import type {
  ProviderCapability,
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
  readonly capability?: ProviderCapability;
  execute(request: ProviderRequest, options: ProviderExecutionOptions): Promise<ProviderResult>;
}
