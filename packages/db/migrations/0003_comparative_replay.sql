CREATE TABLE IF NOT EXISTS "comparison_experiments" (
  "id" text PRIMARY KEY NOT NULL,
  "tenant_id" text NOT NULL,
  "original_execution_id" text NOT NULL REFERENCES "executions"("id"),
  "variant_execution_id" text REFERENCES "executions"("id"),
  "status" text NOT NULL,
  "requested_variation" jsonb NOT NULL,
  "resolved_variant" jsonb NOT NULL,
  "unavailable_reason" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "comparison_experiments_tenant_id_id_idx"
  ON "comparison_experiments" ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "comparison_experiments_original_idx"
  ON "comparison_experiments" ("tenant_id", "original_execution_id");
CREATE INDEX IF NOT EXISTS "comparison_experiments_variant_idx"
  ON "comparison_experiments" ("tenant_id", "variant_execution_id");
