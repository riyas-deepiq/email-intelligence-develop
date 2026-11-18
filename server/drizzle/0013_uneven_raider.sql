ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "sentiment" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "search_queries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "user_id" uuid,
  "query_text" text NOT NULL,
  "intent" text,
  "response_ms" integer NOT NULL,
  "success" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "search_queries"
    ADD CONSTRAINT "search_queries_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "search_queries"
    ADD CONSTRAINT "search_queries_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "search_queries_org_created_idx" ON "search_queries" USING btree ("org_id","created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "topics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL,
  "name" text NOT NULL,
  "message_count" integer DEFAULT 0 NOT NULL,
  "last_seen_at" timestamp with time zone
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "topics"
    ADD CONSTRAINT "topics_org_id_organizations_id_fk"
      FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "topics_org_idx" ON "topics" USING btree ("org_id");
