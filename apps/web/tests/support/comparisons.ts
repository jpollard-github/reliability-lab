import type { APIRequestContext } from "@playwright/test";
import { apiBaseUrl, tenantHeaders } from "./api";

export async function createComparison(request: APIRequestContext, executionId: string) {
  const response = await request.post(`${apiBaseUrl}/v1/executions/${executionId}/comparisons`, {
    headers: tenantHeaders,
    data: {
      variation: {
        policy: {
          maxAttempts: 1,
          fallbackProvider: "fake-fallback",
          fallbackModel: "fallback-v1",
        },
      },
    },
  });
  const body = (await response.json()) as {
    experiment: { experimentId: string; variantExecutionId?: string };
  };
  return { response, ...body };
}
