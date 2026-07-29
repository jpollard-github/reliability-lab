"use client";

export const browserApiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const browserTenantId = process.env.NEXT_PUBLIC_DEMO_TENANT_ID ?? "demo-tenant";

export async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${browserApiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      "x-tenant-id": browserTenantId,
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(safeErrorMessage(body) ?? `Request failed with HTTP ${response.status}`);
  }
  return body as T;
}

function safeErrorMessage(value: unknown): string | null {
  return isRecord(value) && typeof value.message === "string" ? value.message : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
