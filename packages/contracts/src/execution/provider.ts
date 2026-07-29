import { Type, type Static } from "@sinclair/typebox";
import type { ExecutionId, TenantId } from "../common/identifiers.js";
import type { FailureMode } from "./status.js";

/**
 * Provider-facing request and response evidence.
 * It defines portable data only; provider adapters own network behavior.
 */
export const MessageSchema = Type.Object(
  {
    role: Type.Union([Type.Literal("system"), Type.Literal("user"), Type.Literal("assistant")]),
    content: Type.String({ minLength: 1, maxLength: 100_000 }),
  },
  { additionalProperties: false },
);
export type Message = Static<typeof MessageSchema>;

export interface ProviderRequest {
  executionId: ExecutionId;
  tenantId: TenantId;
  provider: string;
  model: string;
  messages?: Message[];
  input?: string;
  structuredOutputSchema?: Record<string, unknown>;
  failureMode?: FailureMode;
  attempt: number;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd?: number;
}

export interface StructuredOutputValidation {
  valid: boolean;
  errors?: string[];
}

export interface ProviderResponse {
  provider: string;
  model: string;
  outputText: string;
  outputJson?: unknown;
  usage: ProviderUsage;
  latencyMs: number;
  validation?: StructuredOutputValidation;
}
