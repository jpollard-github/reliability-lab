/** Transport-only headers and error schemas shared by route families. */
import { Type } from "@sinclair/typebox";

export const TenantHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
  "idempotency-key": Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
});

export const TenantOnlyHeadersSchema = Type.Object({
  "x-tenant-id": Type.String({ minLength: 1, maxLength: 128 }),
});

export const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Integer(),
});
