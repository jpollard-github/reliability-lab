/** Owns durable execution-job storage shape; worker coordination behavior lives under durable/. */
import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import type { ExecutionJobStatus } from "@reliability-lab/contracts";
import { bytea } from "./schema-types.js";
import { executions } from "./executions.js";

export const executionJobs = pgTable(
  "execution_jobs",
  {
    executionId: text("execution_id")
      .primaryKey()
      .references(() => executions.id),
    tenantId: text("tenant_id").notNull(),
    status: text("status").$type<ExecutionJobStatus>().notNull(),
    payloadSchemaVersion: integer("payload_schema_version").notNull(),
    keyVersion: text("key_version").notNull(),
    ciphertext: bytea("ciphertext"),
    nonce: bytea("nonce"),
    authenticationTag: bytea("authentication_tag"),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    claimCount: integer("claim_count").notNull().default(0),
    lastSafeErrorCode: text("last_safe_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    terminalAt: timestamp("terminal_at", { withTimezone: true }),
    payloadDeletedAt: timestamp("payload_deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("execution_jobs_claim_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
    index("execution_jobs_tenant_idx").on(table.tenantId, table.executionId),
  ],
);
