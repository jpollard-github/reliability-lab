CREATE INDEX IF NOT EXISTS "executions_investigation_time_idx"
  ON "executions" ("tenant_id", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "executions_investigation_status_idx"
  ON "executions" ("tenant_id", "status", "created_at" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "execution_events_execution_type_idx"
  ON "execution_events" ("execution_id", "type");
