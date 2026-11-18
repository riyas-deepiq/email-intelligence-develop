-- =============================================================================
-- 0001_init_migration.sql
-- Single consolidated migration — merges all prior migrations (0000–0007)
-- plus migration 0008 (sync config, probe fields, org flags, owner_user_id).
-- Drop the old DB and apply this once to get a clean state.
-- =============================================================================

-- ── Enums ─────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."user_role" AS ENUM ('employee', 'admin', 'superadmin');
CREATE TYPE "public"."auth_provider_type" AS ENUM ('email_password', 'm365', 'google');

-- ── users ─────────────────────────────────────────────────────────────────────

CREATE TABLE "users" (
  "id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email"         text        NOT NULL,
  "display_name"  text        NOT NULL,
  "password_hash" text,
  "role"          "user_role" NOT NULL DEFAULT 'employee',
  "idp_subject"   text,
  "status"        text        NOT NULL DEFAULT 'active',
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "users_email_unique" UNIQUE ("email")
);

-- ── organizations ─────────────────────────────────────────────────────────────

CREATE TABLE "organizations" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name"                  text        NOT NULL,
  "domains"               text        NOT NULL,
  "admin_email"           text        NOT NULL,
  -- JIT provisioning (added in 0006)
  "jit_enabled"           boolean     NOT NULL DEFAULT false,
  "jit_default_role"      text        NOT NULL DEFAULT 'employee',
  -- Sync configuration (new — 0008)
  "sync_enabled"          boolean     NOT NULL DEFAULT true,
  "global_sync_from_date" timestamptz,
  -- Setup wizard optional-step skips (new — 0008)
  "sso_skipped"           boolean     NOT NULL DEFAULT false,
  "hierarchy_skipped"     boolean     NOT NULL DEFAULT false,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);

-- ── auth_providers ────────────────────────────────────────────────────────────

CREATE TABLE "auth_providers" (
  "id"                   uuid                  PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider"             "auth_provider_type"  NOT NULL,
  "enabled"              boolean               NOT NULL DEFAULT false,
  "tenant_id"            text,
  "client_id"            text,
  "client_secret"        text,                 -- AES-256-GCM encrypted at rest
  "redirect_uri"         text,
  "service_account_json" text,                 -- AES-256-GCM encrypted Google DWD JSON (added in 0004)
  "created_at"           timestamptz           NOT NULL DEFAULT now(),
  "updated_at"           timestamptz           NOT NULL DEFAULT now(),
  CONSTRAINT "auth_providers_provider_unique" UNIQUE ("provider")
);

-- ── mailboxes ─────────────────────────────────────────────────────────────────

CREATE TABLE "mailboxes" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"               uuid        NOT NULL,
  "owner_user_id"        uuid,                 -- FK to users.id; null = shared / org-level mailbox
  "address"              text        NOT NULL,
  "provider"             text        NOT NULL, -- 'm365' | 'google'
  "provider_user_id"     text,                 -- Graph objectId / Google userId
  "sync_token"           text,                 -- delta/history token for incremental sync
  "status"               text        NOT NULL DEFAULT 'active',      -- 'active' | 'paused' | 'error'
  "sync_status"          text        NOT NULL DEFAULT 'not_started', -- 'not_started' | 'syncing' | 'complete' | 'error'
  -- Sync configuration per mailbox
  "sync_enabled"         boolean     NOT NULL DEFAULT true,
  "sync_from_date"       timestamptz,          -- admin-set start date; null = all history
  "sync_priority"        integer     NOT NULL DEFAULT 0,             -- 1 = high priority first pass
  -- Probe results; populated by collector probe job after connect
  "probe_status"         text        NOT NULL DEFAULT 'pending',     -- 'pending' | 'running' | 'done' | 'error'
  "earliest_email_at"    timestamptz,          -- oldest email date from provider
  "email_count_estimate" integer,              -- rough message count from provider
  -- Sync counters
  "total_messages"       integer     NOT NULL DEFAULT 0,
  "synced_messages"      integer     NOT NULL DEFAULT 0,
  "last_sync_at"         timestamptz,
  -- Directory profile (populated at provider-connect time from Microsoft Graph / Google Directory API)
  "display_name"         text,
  "given_name"           text,
  "family_name"          text,
  "job_title"            text,
  "department_name"      text,
  -- Profile photo (raw base64, no data URI prefix; null = no photo)
  "photo_content_type"   text        DEFAULT 'image/jpeg',
  "photo_data"           text,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mailboxes_address_unique" UNIQUE ("address"),
  CONSTRAINT "mailboxes_org_id_fk"    FOREIGN KEY ("org_id")        REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "mailboxes_owner_fk"     FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")         ON DELETE SET NULL
);

-- ── sessions ──────────────────────────────────────────────────────────────────

CREATE TABLE "sessions" (
  "session_id" text        PRIMARY KEY,
  "user_id"    text        NOT NULL,
  "expires_at" timestamptz NOT NULL
);

CREATE INDEX "sessions_expires_at_idx" ON "sessions" ("expires_at");

-- ── audit_log ─────────────────────────────────────────────────────────────────

CREATE TABLE "audit_log" (
  "id"          bigserial   PRIMARY KEY NOT NULL,
  "ts"          timestamptz NOT NULL DEFAULT now(),
  "actor_id"    uuid,                   -- null for system / unauthenticated events
  "actor_email" text        NOT NULL,
  "actor_role"  text        NOT NULL,
  "ip_address"  text,
  "session_id"  text,
  "event_type"  text        NOT NULL,   -- 'auth.login', 'user.role_changed', …
  "entity_type" text        NOT NULL,   -- 'user' | 'organization' | 'auth_provider' | 'mailbox'
  "entity_id"   text        NOT NULL,
  "old_value"   jsonb,                  -- snapshot before change (null on CREATE)
  "new_value"   jsonb                   -- snapshot after  change (null on DELETE)
);

CREATE INDEX "audit_log_ts_idx"         ON "audit_log" ("ts" DESC);
CREATE INDEX "audit_log_actor_idx"      ON "audit_log" ("actor_id");
CREATE INDEX "audit_log_entity_idx"     ON "audit_log" ("entity_type", "entity_id");
CREATE INDEX "audit_log_event_type_idx" ON "audit_log" ("event_type");

-- Append-only enforcement: no one can UPDATE or DELETE audit rows
REVOKE UPDATE, DELETE ON "audit_log" FROM PUBLIC;

-- ── threads ───────────────────────────────────────────────────────────────────

CREATE TABLE "threads" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"              uuid        NOT NULL,
  "mailbox_id"          uuid        NOT NULL,
  "provider_thread_id"  text        NOT NULL,
  "subject"             text,
  "participant_emails"  jsonb       NOT NULL DEFAULT '[]',
  "message_count"       integer     NOT NULL DEFAULT 0,
  "has_attachments"     boolean     NOT NULL DEFAULT false,
  "first_message_at"    timestamptz,
  "last_message_at"     timestamptz,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "threads_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "threads_mailbox_fk" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id")     ON DELETE CASCADE
);

CREATE INDEX "threads_mailbox_thread_idx" ON "threads" ("mailbox_id", "provider_thread_id");
CREATE INDEX "threads_org_last_msg_idx"   ON "threads" ("org_id", "last_message_at" DESC);

-- ── messages ──────────────────────────────────────────────────────────────────

CREATE TABLE "messages" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id"              uuid        NOT NULL,
  "mailbox_id"          uuid        NOT NULL,
  "thread_id"           uuid,
  "provider_message_id" text        NOT NULL,
  "provider_thread_id"  text,
  "rfc_message_id"      text,
  "subject"             text,
  "from_address"        text        NOT NULL,
  "from_name"           text,
  "to_addresses"        jsonb       NOT NULL DEFAULT '[]',
  "cc_addresses"        jsonb       NOT NULL DEFAULT '[]',
  "bcc_addresses"       jsonb       NOT NULL DEFAULT '[]',
  "body_text"           text,
  "has_attachments"     boolean     NOT NULL DEFAULT false,
  "received_at"         timestamptz NOT NULL,
  "sent_at"             timestamptz,
  "size_bytes"          integer,
  "importance"          text        NOT NULL DEFAULT 'normal',
  "is_read"             boolean     NOT NULL DEFAULT false,
  "labels"              jsonb       NOT NULL DEFAULT '[]',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "messages_org_fk"     FOREIGN KEY ("org_id")     REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "messages_mailbox_fk" FOREIGN KEY ("mailbox_id") REFERENCES "mailboxes"("id")     ON DELETE CASCADE,
  CONSTRAINT "messages_thread_fk"  FOREIGN KEY ("thread_id")  REFERENCES "threads"("id")       ON DELETE SET NULL
);

CREATE INDEX "messages_mailbox_provider_id_idx" ON "messages" ("mailbox_id", "provider_message_id");
CREATE INDEX "messages_rfc_id_idx"              ON "messages" ("rfc_message_id");
CREATE INDEX "messages_mailbox_received_idx"    ON "messages" ("mailbox_id", "received_at" DESC);
CREATE INDEX "messages_thread_idx"              ON "messages" ("thread_id");
CREATE INDEX "messages_org_received_idx"        ON "messages" ("org_id", "received_at" DESC);

