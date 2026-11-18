CREATE TABLE IF NOT EXISTS "roles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "base_role" "user_role" NOT NULL DEFAULT 'employee',
  "permissions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "roles_name_unique" UNIQUE ("name")
);

CREATE INDEX IF NOT EXISTS "roles_base_role_idx" ON "roles" ("base_role");

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_id" uuid;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_role_id_roles_id_fk"
    FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "users_role_id_idx" ON "users" ("role_id");
