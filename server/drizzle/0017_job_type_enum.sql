-- Rename ingestion job kinds to self-explanatory names and constrain them
-- with a proper Postgres enum (pre-go-live rename, agreed 2026-07-13):
--   probe            → mailbox_scan          (count + oldest email, downloads nothing)
--   backfill         → initial_import        (first-ever download of history)
--   incremental      → new_mail_check        (only what arrived since last run)
--   backfill_extend  → sync_range_extension  (admin deepened range — fetch the older gap)
-- The column itself is renamed kind → job_type.

CREATE TYPE "job_type" AS ENUM ('mailbox_scan', 'initial_import', 'new_mail_check', 'sync_range_extension');

-- 1. Migrate the stored values while the column is still text.
UPDATE "ingestion_jobs" SET "kind" = CASE "kind"
  WHEN 'probe'           THEN 'mailbox_scan'
  WHEN 'backfill'        THEN 'initial_import'
  WHEN 'incremental'     THEN 'new_mail_check'
  WHEN 'backfill_extend' THEN 'sync_range_extension'
  ELSE "kind"
END;

-- 2. Rename the column, then convert it to the enum (dependent indexes are
--    rebuilt automatically).
ALTER TABLE "ingestion_jobs" RENAME COLUMN "kind" TO "job_type";
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_type" DROP DEFAULT;
ALTER TABLE "ingestion_jobs"
  ALTER COLUMN "job_type" TYPE "job_type" USING "job_type"::"job_type";
ALTER TABLE "ingestion_jobs" ALTER COLUMN "job_type" SET DEFAULT 'new_mail_check';

-- 3. Keep the partial-unique index name in line with the new column name.
ALTER INDEX "ingestion_jobs_one_active_per_mailbox_kind_idx"
  RENAME TO "ingestion_jobs_one_active_per_mailbox_type_idx";
