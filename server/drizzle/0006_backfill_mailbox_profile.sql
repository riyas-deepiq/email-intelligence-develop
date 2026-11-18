-- Backfill any mailbox profile columns that may be missing.
-- All statements use ADD COLUMN IF NOT EXISTS so re-running is safe regardless
-- of whether 0003_mailbox_profile.sql was previously applied manually.

ALTER TABLE "mailboxes"
  ADD COLUMN IF NOT EXISTS "display_name"        text,
  ADD COLUMN IF NOT EXISTS "given_name"           text,
  ADD COLUMN IF NOT EXISTS "family_name"          text,
  ADD COLUMN IF NOT EXISTS "job_title"            text,
  ADD COLUMN IF NOT EXISTS "department_name"      text,
  ADD COLUMN IF NOT EXISTS "photo_content_type"   text DEFAULT 'image/jpeg',
  ADD COLUMN IF NOT EXISTS "photo_data"           text;
