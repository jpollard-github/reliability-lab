import type { APIRequestContext } from "@playwright/test";
import { apiBaseUrl, tenantHeaders } from "./api";

export async function seedCases(
  request: APIRequestContext,
  count: number,
  range: { from: string; to: string },
) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      request.post(`${apiBaseUrl}/v1/investigation-cases`, {
        headers: tenantHeaders,
        data: {
          title: `Pagination case ${String(index).padStart(2, "0")}`,
          question: "Does case pagination remain stable?",
          savedScope: { range },
        },
      }),
    ),
  );
}
