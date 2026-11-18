-- Backfill watermark: how far back a mailbox has actually been backfilled,
-- independent of sync_token (the forward/incremental cursor). Uses
-- ADD COLUMN IF NOT EXISTS since this may already exist from a manual patch.

ALTER TABLE "mailboxes"
  ADD COLUMN IF NOT EXISTS "backfilled_from_at" timestamp with time zone;
