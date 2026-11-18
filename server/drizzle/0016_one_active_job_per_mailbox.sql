-- Enforce "at most one active job of each kind per mailbox" at the database
-- level. Job-creation code has always assumed this (inserts are wrapped in
-- try/catch with an "already active — skipped" log), but no constraint
-- actually existed, so double-clicking "Start sync" or an overlapping cron
-- tick could queue duplicate jobs for the same mailbox.

-- 1. Clean up any existing duplicates first: for each (mailbox, kind) group of
--    active jobs, keep the newest and mark the rest dead.
UPDATE "ingestion_jobs" j
SET "status"      = 'dead',
    "error"       = 'Superseded by a newer duplicate active job (cleaned by migration 0016)',
    "finished_at" = now(),
    "updated_at"  = now()
WHERE j."status" IN ('pending', 'claimed', 'running')
  AND EXISTS (
    SELECT 1 FROM "ingestion_jobs" newer
    WHERE newer."mailbox_id" = j."mailbox_id"
      AND newer."kind"       = j."kind"
      AND newer."status" IN ('pending', 'claimed', 'running')
      AND (newer."created_at" > j."created_at"
           OR (newer."created_at" = j."created_at" AND newer."id" > j."id"))
  );

-- 2. Partial unique index: only active statuses participate, so history rows
--    (done/failed/dead) never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS "ingestion_jobs_one_active_per_mailbox_kind_idx"
  ON "ingestion_jobs" ("mailbox_id", "kind")
  WHERE "status" IN ('pending', 'claimed', 'running');
