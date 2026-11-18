-- Operational alerts surfaced on the Alerts page. Guarded with IF NOT EXISTS /
-- duplicate_object checks since this may already exist from a manual patch.

DO $$ BEGIN
  CREATE TYPE "alert_severity" AS ENUM ('critical', 'warning', 'info');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "alerts" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"      uuid NOT NULL,
  "severity"    "alert_severity" NOT NULL,
  "category"    text NOT NULL,
  "title"       text NOT NULL,
  "description" text NOT NULL,
  "source"      text NOT NULL,
  "mailbox_id"  uuid,
  "read"        boolean NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_org_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "alerts"
    ADD CONSTRAINT "alerts_mailbox_id_fk"
      FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "alerts_org_created_idx" ON "alerts" ("org_id", "created_at");
