-- Per-org sync schedule configuration.
-- One row per organisation (unique on org_id).
-- Controls business-hours vs off-hours sync intervals and initial sync range.

CREATE TABLE IF NOT EXISTS "org_sync_config" (
  "id"                            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"                        uuid NOT NULL,
  "timezone"                      text NOT NULL DEFAULT 'UTC',
  "business_hours_start"          text NOT NULL DEFAULT '09:00',
  "business_hours_end"            text NOT NULL DEFAULT '18:00',
  "business_days"                 text NOT NULL DEFAULT '1,2,3,4,5',
  "business_hours_interval_min"   integer NOT NULL DEFAULT 5,
  "off_hours_interval_min"        integer NOT NULL DEFAULT 60,
  "initial_sync_days"             integer DEFAULT 90,
  "created_at"                    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "org_sync_config_org_id_idx" ON "org_sync_config" ("org_id");

ALTER TABLE "org_sync_config"
  ADD CONSTRAINT "org_sync_config_org_id_organizations_id_fk"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE;
