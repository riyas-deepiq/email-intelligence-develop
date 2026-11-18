-- =============================================================================
-- 0003_mailbox_profile.sql
-- Adds directory profile fields to mailboxes:
--   display_name, given_name, family_name, job_title, department_name, photo_data
-- Populated at provider-connect time from Microsoft Graph / Google Directory API.
-- =============================================================================

ALTER TABLE "mailboxes"
  ADD COLUMN IF NOT EXISTS "display_name"    text,
  ADD COLUMN IF NOT EXISTS "given_name"      text,
  ADD COLUMN IF NOT EXISTS "family_name"     text,
  ADD COLUMN IF NOT EXISTS "job_title"       text,
  ADD COLUMN IF NOT EXISTS "department_name" text,
  ADD COLUMN IF NOT EXISTS "photo_data"      text;   -- base64 data URI (data:image/jpeg;base64,...)