import {
  bigint,
  boolean,
  customType,
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
  ComparisonExperimentStatus,
  ExecutionAttempt,
  ExecutionBudget,
  ExecutionEvent,
  ExecutionJobStatus,
  ExecutionPolicy,
  ExecutionStatus,
  InvestigationCaseEvidenceInput,
  InvestigationCaseEventType,
  InvestigationCaseImportance,
  InvestigationCaseStatus,
  ProviderError,
  ReplayVariation,
  ResolvedReplayConfiguration,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

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

export const comparisonExperiments = pgTable(
  "comparison_experiments",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    originalExecutionId: text("original_execution_id")
      .notNull()
      .references(() => executions.id),
    variantExecutionId: text("variant_execution_id").references(() => executions.id),
    status: text("status").$type<ComparisonExperimentStatus>().notNull(),
    requestedVariation: jsonb("requested_variation").$type<ReplayVariation>().notNull(),
    resolvedVariant: jsonb("resolved_variant").$type<ResolvedReplayConfiguration>().notNull(),
    unavailableReason: text("unavailable_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("comparison_experiments_tenant_id_id_idx").on(table.tenantId, table.id),
    index("comparison_experiments_original_idx").on(table.tenantId, table.originalExecutionId),
    index("comparison_experiments_variant_idx").on(table.tenantId, table.variantExecutionId),
  ],
);

export const investigationCases = pgTable(
  "investigation_cases",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    title: text("title").notNull(),
    question: text("question").notNull(),
    status: text("status").$type<InvestigationCaseStatus>().notNull(),
    importance: text("importance").$type<InvestigationCaseImportance>(),
    savedScope: jsonb("saved_scope").$type<SavedInvestigationScope>().notNull(),
    finding: text("finding"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("investigation_cases_tenant_id_id_idx").on(table.tenantId, table.id),
    index("investigation_cases_tenant_status_updated_idx").on(
      table.tenantId,
      table.status,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    index("investigation_cases_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
  ],
);

export const investigationCaseNotes = pgTable(
  "investigation_case_notes",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => investigationCases.id),
    tenantId: text("tenant_id").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("investigation_case_notes_tenant_case_time_idx").on(
      table.tenantId,
      table.caseId,
      table.createdAt,
      table.id,
    ),
  ],
);

export const investigationCaseEvidence = pgTable(
  "investigation_case_evidence",
  {
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => investigationCases.id),
    tenantId: text("tenant_id").notNull(),
    type: text("type").$type<InvestigationCaseEvidenceInput["type"]>().notNull(),
    identity: text("identity").notNull(),
    reference: jsonb("reference").$type<InvestigationCaseEvidenceInput>().notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("investigation_case_evidence_identity_idx").on(
      table.tenantId,
      table.caseId,
      table.identity,
    ),
    index("investigation_case_evidence_execution_idx").on(
      table.tenantId,
      table.type,
      table.identity,
    ),
    index("investigation_case_evidence_case_time_idx").on(
      table.tenantId,
      table.caseId,
      table.addedAt,
      table.id,
    ),
  ],
);

export const investigationCaseEvents = pgTable(
  "investigation_case_events",
  {
    ordinal: bigint("ordinal", { mode: "number" }).generatedAlwaysAsIdentity(),
    id: text("id").primaryKey(),
    caseId: text("case_id")
      .notNull()
      .references(() => investigationCases.id),
    tenantId: text("tenant_id").notNull(),
    type: text("type").$type<InvestigationCaseEventType>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull(),
  },
  (table) => [
    index("investigation_case_events_tenant_case_time_idx").on(
      table.tenantId,
      table.caseId,
      table.ordinal,
    ),
  ],
);

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
