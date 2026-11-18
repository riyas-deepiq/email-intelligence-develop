ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "attachments_indexed_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id"             uuid NOT NULL,
  "provider_attachment_id" text NOT NULL,
  "name"                   text NOT NULL,
  "content_type"           text,
  "size_bytes"             integer,
  "is_inline"              boolean NOT NULL DEFAULT false,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_message_id_fk"
    FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "attachments_msg_provider_idx"
  ON "attachments" ("message_id", "provider_attachment_id");

CREATE INDEX IF NOT EXISTS "attachments_name_idx"
  ON "attachments" ("name");
