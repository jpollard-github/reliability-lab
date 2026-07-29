/**
 * Owns execution projections, attempt evidence, append-only events, and idempotency schema.
 * Repository behavior lives under execution/ and durable/.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  ExecutionAttempt,
  ExecutionBudget,
  ExecutionEvent,
  ExecutionPolicy,
  ExecutionStatus,
  ProviderError,
} from "@reliability-lab/contracts";

export const executions = pgTable(
  "executions",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    status: text("status").$type<ExecutionStatus>().notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    traceId: text("trace_id").notNull(),
    requestHash: text("request_hash").notNull(),
    policy: jsonb("policy").$type<ExecutionPolicy>().notNull(),
    budget: jsonb("budget").$type<ExecutionBudget>().notNull(),
    outputText: text("output_text"),
    outputJson: jsonb("output_json").$type<unknown>(),
    error: jsonb("error").$type<ProviderError>(),
    replayOfExecutionId: text("replay_of_execution_id"),
    replayable: boolean("replayable").notNull().default(false),
    replayUnavailableReason: text("replay_unavailable_reason"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("executions_tenant_id_id_idx").on(table.tenantId, table.id),
    uniqueIndex("executions_trace_id_idx").on(table.traceId),
    index("executions_investigation_time_idx").on(
      table.tenantId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("executions_investigation_status_idx").on(
      table.tenantId,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const executionAttempts = pgTable(
  "execution_attempts",
  {
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    attemptNumber: integer("attempt_number").notNull(),
    data: jsonb("data").$type<ExecutionAttempt>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.executionId, table.attemptNumber] })],
);

export const executionEvents = pgTable(
  "execution_events",
  {
    eventId: text("event_id").primaryKey(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    sequence: integer("sequence").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    type: text("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<ExecutionEvent>().notNull(),
  },
  (table) => [
    uniqueIndex("execution_events_execution_sequence_idx").on(table.executionId, table.sequence),
    index("execution_events_execution_type_idx").on(table.executionId, table.type),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    tenantId: text("tenant_id").notNull(),
    keyHash: text("key_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    executionId: text("execution_id")
      .notNull()
      .references(() => executions.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    responseCode: integer("response_code").notNull().default(202),
    reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.keyHash] })],
);
