export const apiBaseUrl = "http://127.0.0.1:4000";
export const tenantHeaders = { "x-tenant-id": "demo-tenant" };

export function uniqueIdempotencyKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}
