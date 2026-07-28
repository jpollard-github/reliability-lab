ALTER TABLE "replay_capsules"
  ADD COLUMN IF NOT EXISTS "unreadable_at" timestamp with time zone;
