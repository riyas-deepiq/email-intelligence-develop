-- Probe status previously defaulted to 'pending', which the UI could not tell
-- apart from a real, actively-queued probe job — every freshly discovered
-- mailbox looked like it was already being probed. Default new mailboxes to
-- 'not_started' instead, and reclassify existing mailboxes that were only ever
-- auto-defaulted (never actually had a probe job queued) to match.

ALTER TABLE "mailboxes" ALTER COLUMN "probe_status" SET DEFAULT 'not_started';

UPDATE "mailboxes" m
SET "probe_status" = 'not_started'
WHERE m."probe_status" = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM "ingestion_jobs" j
    WHERE j."mailbox_id" = m."id" AND j."kind" = 'probe'
  );
