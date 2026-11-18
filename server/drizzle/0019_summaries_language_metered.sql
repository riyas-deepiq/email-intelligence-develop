-- Three additions from the original database design (docs/04-database-design.md)
-- that were never built. All additive — no existing column, index or constraint
-- is altered, so this is safe to apply to a populated database.
--
--   1. summaries          persist AI summaries instead of an in-process Map
--   2. messages.language  per-message language tag (multilingual requirement)
--   3. mailboxes.metered  per-mailbox licence counting

-- 1 ── summaries ─────────────────────────────────────────────────────────────
-- Replaces the in-memory cache in services/summarizer.service.ts, which loses
-- every summary on restart and is not shared across server instances.
--
-- ref_id is intentionally not a foreign key: it points at messages.id when
-- scope = 'email' and threads.id when scope = 'thread'. Postgres has no
-- polymorphic FK; cleanup rides on the org_id cascade.

-- CREATE TYPE has no IF NOT EXISTS, so guard it the standard way — this keeps
-- the whole migration re-runnable like the ALTERs below it.
DO $$ BEGIN
  CREATE TYPE "summary_scope" AS ENUM ('email', 'thread');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "summaries" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "scope"      "summary_scope" NOT NULL,
  "ref_id"     uuid NOT NULL,
  "summary"    text NOT NULL,
  -- Staleness key: `${messageCount}:${latestReceivedAtMs}`. A thread that gains
  -- a message produces a different key, so a stored row reads as stale rather
  -- than silently wrong. Callers compare before trusting a hit.
  "source_key" text NOT NULL,
  "model"      text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "summaries_scope_ref_idx" ON "summaries" ("scope", "ref_id");
CREATE INDEX IF NOT EXISTS "summaries_org_idx" ON "summaries" ("org_id");

-- 2 ── messages.language ─────────────────────────────────────────────────────
-- BCP-47 tag ('en' | 'si' | 'ta' | 'hi' | …). Nullable, and null on every
-- existing row: nothing detects language yet. The column exists so retrieval
-- and OCR can branch on it without a later migration over a large table.

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "language" text;

-- 3 ── mailboxes.metered ─────────────────────────────────────────────────────
-- The product is licensed per ingested mailbox, but there was no column to
-- count from. Defaults true so every already-connected mailbox is billable on
-- backfill; exempt shared/service accounts by setting it false explicitly.
--   Metering reads: WHERE metered = true AND status = 'active'

ALTER TABLE "mailboxes" ADD COLUMN IF NOT EXISTS "metered" boolean DEFAULT true NOT NULL;
