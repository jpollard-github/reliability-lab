import { customType } from "drizzle-orm/pg-core";

/** PostgreSQL binary column used by both command and replay ciphertext records. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
