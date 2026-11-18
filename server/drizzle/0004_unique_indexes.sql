-- Convert plain indexes to UNIQUE to enforce deduplication at the DB level.
-- onConflictDoNothing() in the sync pipeline silently ignored without these.

-- threads: one row per (mailbox_id, provider_thread_id)
DROP INDEX IF EXISTS "threads_mailbox_thread_idx";
CREATE UNIQUE INDEX "threads_mailbox_thread_idx" ON "threads" ("mailbox_id", "provider_thread_id");

-- messages: one row per (mailbox_id, provider_message_id)
DROP INDEX IF EXISTS "messages_mailbox_provider_id_idx";
CREATE UNIQUE INDEX "messages_mailbox_provider_id_idx" ON "messages" ("mailbox_id", "provider_message_id");
