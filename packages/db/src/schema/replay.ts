/** Owns encrypted replay-capsule retention records and their metadata-only audit log. */
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { bytea } from "./schema-types.js";
import { executions } from "./executions.js";

export const replayCapsules = pgTable(
  "replay_capsules",
  {
    tenantId: text("tenant_id").notNull(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    payloadSchemaVersion: integer("payload_schema_version").notNull(),
    keyVersion: text("key_version").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    nonce: bytea("nonce").notNull(),
    authenticationTag: bytea("authentication_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    unreadableAt: timestamp("unreadable_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.executionId] }),
    index("replay_capsules_expiry_idx").on(table.expiresAt),
  ],
);

export const replayCapsuleAudits = pgTable(
  "replay_capsule_audits",
  {
    auditId: text("audit_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    executionId: text("execution_id").notNull(),
    operation: text("operation").notNull(),
    outcome: text("outcome").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    keyVersion: text("key_version"),
  },
  (table) => [
    index("replay_capsule_audits_identity_time_idx").on(
      table.tenantId,
      table.executionId,
      table.occurredAt,
    ),
  ],
);
