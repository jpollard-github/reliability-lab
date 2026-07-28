CREATE TABLE "investigation_cases" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "schema_version" integer DEFAULT 1 NOT NULL,
  "title" text NOT NULL,
  "question" text NOT NULL,
  "status" text NOT NULL,
  "importance" text,
  "saved_scope" jsonb NOT NULL,
  "finding" text,
  "resolution" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "investigation_cases_status_check"
    CHECK ("status" IN ('open', 'investigating', 'resolved', 'archived')),
  CONSTRAINT "investigation_cases_importance_check"
    CHECK ("importance" IS NULL OR "importance" IN ('routine', 'notable', 'urgent'))
);

CREATE TABLE "investigation_case_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL REFERENCES "investigation_cases"("id"),
  "tenant_id" text NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL
);

CREATE TABLE "investigation_case_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL REFERENCES "investigation_cases"("id"),
  "tenant_id" text NOT NULL,
  "type" text NOT NULL,
  "identity" text NOT NULL,
  "reference" jsonb NOT NULL,
  "added_at" timestamp with time zone NOT NULL,
  CONSTRAINT "investigation_case_evidence_type_check"
    CHECK ("type" IN ('execution', 'comparison', 'provider_observation'))
);

CREATE TABLE "investigation_case_events" (
  "ordinal" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL REFERENCES "investigation_cases"("id"),
  "tenant_id" text NOT NULL,
  "type" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "metadata" jsonb NOT NULL
);

CREATE UNIQUE INDEX "investigation_cases_tenant_id_id_idx"
  ON "investigation_cases" ("tenant_id", "id");
CREATE INDEX "investigation_cases_tenant_status_updated_idx"
  ON "investigation_cases" ("tenant_id", "status", "updated_at" DESC, "id" DESC);
CREATE INDEX "investigation_cases_tenant_updated_idx"
  ON "investigation_cases" ("tenant_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "investigation_case_notes_tenant_case_time_idx"
  ON "investigation_case_notes" ("tenant_id", "case_id", "created_at", "id");
CREATE UNIQUE INDEX "investigation_case_evidence_identity_idx"
  ON "investigation_case_evidence" ("tenant_id", "case_id", "identity");
CREATE INDEX "investigation_case_evidence_execution_idx"
  ON "investigation_case_evidence" ("tenant_id", "type", "identity");
CREATE INDEX "investigation_case_evidence_case_time_idx"
  ON "investigation_case_evidence" ("tenant_id", "case_id", "added_at", "id");
CREATE INDEX "investigation_case_events_tenant_case_time_idx"
  ON "investigation_case_events" ("tenant_id", "case_id", "ordinal");
