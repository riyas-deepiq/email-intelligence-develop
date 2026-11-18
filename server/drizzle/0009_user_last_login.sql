ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;

-- Backfill: any account that already has a password set has, by definition,
-- already completed setup/invite-acceptance at some point before this column
-- existed — without this, every existing active user would show as "Invited"
-- again until their next login.
UPDATE "users"
SET "last_login_at" = "updated_at"
WHERE "password_hash" IS NOT NULL
  AND "last_login_at" IS NULL;
