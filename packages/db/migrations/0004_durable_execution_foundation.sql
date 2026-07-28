CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "execution_id" text PRIMARY KEY NOT NULL REFERENCES "executions"("id"),
  "tenant_id" text NOT NULL,
  "status" text NOT NULL,
  "payload_schema_version" integer NOT NULL,
  "key_version" text NOT NULL,
  "ciphertext" bytea,
  "nonce" bytea,
  "authentication_tag" bytea,
  "available_at" timestamp with time zone NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "claim_count" integer DEFAULT 0 NOT NULL,
  "last_safe_error_code" text,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL,
  "started_at" timestamp with time zone,
  "terminal_at" timestamp with time zone,
  "payload_deleted_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "execution_jobs_claim_idx"
  ON "execution_jobs" ("status", "available_at", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "execution_jobs_tenant_idx"
  ON "execution_jobs" ("tenant_id", "execution_id");
