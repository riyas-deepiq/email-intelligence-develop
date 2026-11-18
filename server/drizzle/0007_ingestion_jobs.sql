CREATE TABLE IF NOT EXISTS "ingestion_jobs" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"       uuid NOT NULL,
  "mailbox_id"   uuid NOT NULL,
  "kind"         text NOT NULL DEFAULT 'incremental',
  "status"       text NOT NULL DEFAULT 'pending',
  "priority"     integer NOT NULL DEFAULT 0,
  "claimed_by"   text,
  "claimed_at"   timestamp with time zone,
  "started_at"   timestamp with time zone,
  "finished_at"  timestamp with time zone,
  "stats"        jsonb DEFAULT '{}',
  "error"        text,
  "retry_count"  integer NOT NULL DEFAULT 0,
  "max_retries"  integer NOT NULL DEFAULT 3,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "ingestion_jobs"
  ADD CONSTRAINT "ingestion_jobs_org_id_fk"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "ingestion_jobs"
  ADD CONSTRAINT "ingestion_jobs_mailbox_id_fk"
    FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "ingestion_jobs_status_priority_idx"
  ON "ingestion_jobs" ("status", "priority" DESC);

CREATE INDEX IF NOT EXISTS "ingestion_jobs_mailbox_idx"
  ON "ingestion_jobs" ("mailbox_id");

CREATE INDEX IF NOT EXISTS "ingestion_jobs_claimed_at_idx"
  ON "ingestion_jobs" ("claimed_at");
