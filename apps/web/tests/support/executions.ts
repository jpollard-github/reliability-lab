import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { apiBaseUrl, tenantHeaders, uniqueIdempotencyKey } from "./api";

interface ExecutionSubmission {
  provider: string;
  model: string;
  input: string;
  failureMode?: string;
  policy?: Record<string, unknown>;
}

export async function createExecution(
  request: APIRequestContext,
  data: ExecutionSubmission,
  prefix = "playwright",
): Promise<{ response: APIResponse; executionId: string; traceId?: string; status?: string }> {
  const response = await request.post(`${apiBaseUrl}/v1/executions`, {
    headers: {
      ...tenantHeaders,
      "idempotency-key": uniqueIdempotencyKey(prefix),
    },
    data,
  });
  const body = (await response.json()) as {
    executionId: string;
    traceId?: string;
    status?: string;
  };
  return { response, ...body };
}

export function createRetryExecution(request: APIRequestContext, input: string, prefix = "retry") {
  return createExecution(
    request,
    {
      provider: "fake-primary",
      model: "deterministic-v1",
      input,
      failureMode: "rate_limit",
      policy: { maxAttempts: 2, baseBackoffMs: 0, maxBackoffMs: 0, jitterRatio: 0 },
    },
    prefix,
  );
}

export function createFallbackExecution(
  request: APIRequestContext,
  input: string,
  prefix = "fallback",
) {
  return createExecution(
    request,
    {
      provider: "fake-primary",
      model: "deterministic-v1",
      input,
      failureMode: "provider_error",
      policy: {
        maxAttempts: 1,
        fallbackProvider: "fake-fallback",
        fallbackModel: "fallback-v1",
      },
    },
    prefix,
  );
}

export async function waitForExecution(
  request: APIRequestContext,
  executionId: string,
  status: string,
) {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBaseUrl}/v1/executions/${executionId}`, {
        headers: tenantHeaders,
      });
      return ((await response.json()) as { status: string }).status;
    })
    .toBe(status);
}

export async function seedExecutions(request: APIRequestContext, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      createExecution(
        request,
        {
          provider: "fake-primary",
          model: "deterministic-v1",
          input: `Pagination evidence ${index}`,
        },
        `pagination-${index}`,
      ),
    ),
  );
}
