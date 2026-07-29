/** Owns saved-case current state, notes, evidence links, and metadata-only timeline schema. */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  InvestigationCaseEvidenceInput,
  InvestigationCaseEventType,
  InvestigationCaseImportance,
  InvestigationCaseStatus,
  SavedInvestigationScope,
} from "@reliability-lab/contracts";

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
