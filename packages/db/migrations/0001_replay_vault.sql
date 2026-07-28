CREATE TABLE IF NOT EXISTS "replay_capsules" (
  "tenant_id" text NOT NULL,
  "execution_id" text NOT NULL REFERENCES "executions"("id"),
  "payload_schema_version" integer NOT NULL,
  "key_version" text NOT NULL,
  "ciphertext" bytea NOT NULL,
  "nonce" bytea NOT NULL,
  "authentication_tag" bytea NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "deleted_at" timestamp with time zone,
  PRIMARY KEY ("tenant_id", "execution_id")
);

CREATE INDEX IF NOT EXISTS "replay_capsules_expiry_idx"
  ON "replay_capsules" ("expires_at");

CREATE TABLE IF NOT EXISTS "replay_capsule_audits" (
  "audit_id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "execution_id" text NOT NULL,
  "operation" text NOT NULL,
  "outcome" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "key_version" text
);

CREATE INDEX IF NOT EXISTS "replay_capsule_audits_identity_time_idx"
  ON "replay_capsule_audits" ("tenant_id", "execution_id", "occurred_at");
