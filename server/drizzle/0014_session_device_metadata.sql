ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "device_name" text;
ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "user_agent" text;
