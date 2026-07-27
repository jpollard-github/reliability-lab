CREATE TABLE IF NOT EXISTS "executions" (
  "id" text PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "trace_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "policy" jsonb NOT NULL,
  "budget" jsonb NOT NULL,
  "output_text" text,
  "output_json" jsonb,
  "error" jsonb,
  "replay_of_execution_id" text,
  "replayable" boolean DEFAULT false NOT NULL,
  "replay_unavailable_reason" text,
  "duration_ms" integer,
  "created_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "executions_tenant_id_id_idx" ON "executions" ("tenant_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "executions_trace_id_idx" ON "executions" ("trace_id");

CREATE TABLE IF NOT EXISTS "execution_attempts" (
  "execution_id" text NOT NULL REFERENCES "executions"("id"),
  "attempt_number" integer NOT NULL,
  "data" jsonb NOT NULL,
  PRIMARY KEY ("execution_id", "attempt_number")
);

CREATE TABLE IF NOT EXISTS "execution_events" (
  "event_id" text PRIMARY KEY,
  "execution_id" text NOT NULL REFERENCES "executions"("id"),
  "sequence" integer NOT NULL,
  "schema_version" integer NOT NULL,
  "type" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "data" jsonb NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "execution_events_execution_sequence_idx"
  ON "execution_events" ("execution_id", "sequence");

CREATE TABLE IF NOT EXISTS "idempotency_records" (
  "tenant_id" text NOT NULL,
  "key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "execution_id" text NOT NULL REFERENCES "executions"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "response_code" integer DEFAULT 202 NOT NULL,
  "reserved_bytes" bigint DEFAULT 0 NOT NULL,
  PRIMARY KEY ("tenant_id", "key_hash")
);
