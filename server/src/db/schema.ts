import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { JOB_TYPE_VALUES, JobType } from '../lib/job-type';

export type EmailAddress = { email: string; name?: string };

export const userRoleEnum = pgEnum('user_role', ['employee', 'admin', 'superadmin']);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description').notNull().default(''),
    baseRole: userRoleEnum('base_role').notNull().default('employee'),
    permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('roles_base_role_idx').on(t.baseRole)],
);

export type RoleRow = typeof roles.$inferSelect;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash'),
  role: userRoleEnum('role').notNull().default('employee'),
  roleId: uuid('role_id').references(() => roles.id, { onDelete: 'set null' }),
  idpSubject: text('idp_subject'),
  status: text('status').notNull().default('active'),
  // Null = never completed a real login (e.g. auto-created from a mailbox import,
  // or invited but hasn't accepted yet) — the source of truth the UI uses to show
  // "Invited" instead of "Active" until the account has actually been used.
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserRow = typeof users.$inferSelect;

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  domains: text('domains').notNull(),
  adminEmail: text('admin_email').notNull(),
  jitEnabled: boolean('jit_enabled').notNull().default(false),
  jitDefaultRole: text('jit_default_role').notNull().default('employee'),
  syncEnabled: boolean('sync_enabled').notNull().default(true),
  globalSyncFromDate: timestamp('global_sync_from_date', { withTimezone: true }),
  ssoSkipped: boolean('sso_skipped').notNull().default(false),
  hierarchySkipped: boolean('hierarchy_skipped').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrgRow = typeof organizations.$inferSelect;

export const authProviderTypeEnum = pgEnum('auth_provider_type', [
  'email_password',
  'm365',
  'google',
]);

export const authProviders = pgTable('auth_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: authProviderTypeEnum('provider').notNull().unique(),
  enabled: boolean('enabled').notNull().default(false),
  tenantId: text('tenant_id'),
  clientId: text('client_id'),
  clientSecret: text('client_secret'),
  redirectUri: text('redirect_uri'),
  serviceAccountJson: text('service_account_json'),
  // Google Workspace ingestion settings. The service-account key is encrypted
  // separately above; these non-secret values are persisted so directory
  // re-sync never has to guess from the Insight Hub administrator account.
  googleAdminEmail: text('google_admin_email'),
  googleCustomerId: text('google_customer_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type AuthProviderRow = typeof authProviders.$inferSelect;

export const mailboxes = pgTable('mailboxes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
  address: text('address').notNull().unique(),
  provider: text('provider').notNull(),
  providerUserId: text('provider_user_id'),
  syncToken: text('sync_token'),
  status: text('status').notNull().default('active'),
  // Counts toward the per-mailbox commercial licence. Defaults true so any
  // mailbox connected for ingestion is billable unless explicitly exempted
  // (shared//service accounts). Metering reads:
  //   WHERE metered = true AND status = 'active'
  metered: boolean('metered').notNull().default(true),
  syncStatus: text('sync_status').notNull().default('not_started'),
  syncEnabled: boolean('sync_enabled').notNull().default(true),
  // Target depth: how far back sync should reach. Falls back to
  // org.globalSyncFromDate when null (materialized onto this column the first
  // time /sync/start runs for this mailbox after the org default is set).
  syncFromDate: timestamp('sync_from_date', { withTimezone: true }),
  // Backfill watermark: how far back this mailbox has ACTUALLY been backfilled.
  // Independent of syncToken (the forward/incremental cursor) — null means no
  // backfill has completed yet. Epoch (1970-01-01) means "backfilled to all time".
  backfilledFromAt: timestamp('backfilled_from_at', { withTimezone: true }),
  syncPriority: integer('sync_priority').notNull().default(0),
  probeStatus: text('probe_status').notNull().default('not_started'),
  earliestEmailAt: timestamp('earliest_email_at', { withTimezone: true }),
  emailCountEstimate: integer('email_count_estimate'),
  totalMessages: integer('total_messages').notNull().default(0),
  syncedMessages: integer('synced_messages').notNull().default(0),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  // Directory profile — populated at provider-connect time
  displayName: text('display_name'),
  givenName: text('given_name'),
  familyName: text('family_name'),
  jobTitle: text('job_title'),
  departmentName: text('department_name'),
  // Profile photo — raw Base64 (no data: URI prefix); null = no photo
  photoContentType: text('photo_content_type').default('image/jpeg'),
  photoData: text('photo_data'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type MailboxRow = typeof mailboxes.$inferSelect;

export const sessions = pgTable(
  'sessions',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    deviceName: text('device_name'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_expires_at_idx').on(t.expiresAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorEmail: text('actor_email').notNull(),
    actorRole: text('actor_role').notNull(),
    ipAddress: text('ip_address'),
    sessionId: text('session_id'),
    eventType: text('event_type').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
  },
  (t) => [
    index('audit_log_ts_idx').on(t.ts),
    index('audit_log_actor_idx').on(t.actorId),
    index('audit_log_entity_idx').on(t.entityType, t.entityId),
    index('audit_log_event_type_idx').on(t.eventType),
  ],
);

// threads
// One row per provider conversation thread (M365 conversationId / Gmail threadId).
// Updated in-place as new messages arrive in the thread.

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    providerThreadId: text('provider_thread_id').notNull(),
    subject: text('subject'),
    participantEmails: jsonb('participant_emails').$type<string[]>().notNull().default([]),
    messageCount: integer('message_count').notNull().default(0),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    firstMessageAt: timestamp('first_message_at', { withTimezone: true }),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('threads_mailbox_thread_idx').on(t.mailboxId, t.providerThreadId),
    index('threads_org_last_msg_idx').on(t.orgId, t.lastMessageAt),
  ],
);

export type ThreadRow = typeof threads.$inferSelect;

// messages
// One row per email message. Body stored as plain text for Phase 1
// (HTML body and raw MIME stored to object storage in Phase 3).

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    threadId: uuid('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    providerMessageId: text('provider_message_id').notNull(), // Graph messageId / Gmail id
    providerThreadId: text('provider_thread_id'), // denormalised for fast insert
    rfcMessageId: text('rfc_message_id'), // Message-ID header
    subject: text('subject'),
    fromAddress: text('from_address').notNull(),
    fromName: text('from_name'),
    toAddresses: jsonb('to_addresses').$type<EmailAddress[]>().notNull().default([]),
    ccAddresses: jsonb('cc_addresses').$type<EmailAddress[]>().notNull().default([]),
    bccAddresses: jsonb('bcc_addresses').$type<EmailAddress[]>().notNull().default([]),
    bodyText: text('body_text'),
    hasAttachments: boolean('has_attachments').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sizeBytes: integer('size_bytes'),
    importance: text('importance').notNull().default('normal'), // 'low' | 'normal' | 'high'
    isRead: boolean('is_read').notNull().default(false),
    labels: jsonb('labels').$type<string[]>().notNull().default([]),
    // When attachment metadata was last indexed from the provider; null = never.
    attachmentsIndexedAt: timestamp('attachments_indexed_at', { withTimezone: true }),
    sentiment: text('sentiment'), // 'positive' | 'neutral' | 'negative' — set by classification pipeline
    // BCP-47 tag ('en' | 'si' | 'ta' | 'hi' | …). Null = not yet detected, which is
    // every row today — nothing populates this. Present because the product is
    // multilingual by requirement and retrieval/OCR will need to branch on it.
    language: text('language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_mailbox_provider_id_idx').on(t.mailboxId, t.providerMessageId),
    index('messages_rfc_id_idx').on(t.rfcMessageId),
    index('messages_mailbox_received_idx').on(t.mailboxId, t.receivedAt),
    index('messages_thread_idx').on(t.threadId),
    index('messages_org_received_idx').on(t.orgId, t.receivedAt),
  ],
);

export type MessageRow = typeof messages.$inferSelect;

// attachments
// Attachment metadata (not file bytes), indexed automatically from the
// provider after mailbox sync, with on-demand indexing as a fallback. Enables
// org-wide filename search and gives RAG stable IDs for file downloads.

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    providerAttachmentId: text('provider_attachment_id').notNull(),
    name: text('name').notNull(),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes'),
    isInline: boolean('is_inline').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('attachments_msg_provider_idx').on(t.messageId, t.providerAttachmentId),
    index('attachments_name_idx').on(t.name),
  ],
);

export type AttachmentRow = typeof attachments.$inferSelect;

// Positions survive user deletion; reporting edges connect positions, never accounts.
export const orgNodes = pgTable(
  'org_nodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .unique(),
    title: text('title').notNull(),
    department: text('department'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('org_nodes_org_idx').on(t.orgId),
    check('org_nodes_title_check', sql`length(btrim(${t.title})) BETWEEN 1 AND 200`),
  ],
);
export type OrgNodeRow = typeof orgNodes.$inferSelect;

export const orgReportingLines = pgTable(
  'org_reporting_lines',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    managerNodeId: uuid('manager_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    reportNodeId: uuid('report_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.managerNodeId, t.reportNodeId] }),
    index('org_reporting_report_idx').on(t.reportNodeId),
    check('org_reporting_no_self', sql`${t.managerNodeId} <> ${t.reportNodeId}`),
  ],
);

export const orgClosure = pgTable(
  'org_closure',
  {
    ancestorNodeId: uuid('ancestor_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    descendantNodeId: uuid('descendant_node_id')
      .notNull()
      .references(() => orgNodes.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.ancestorNodeId, t.descendantNodeId] }),
    index('org_closure_descendant_idx').on(t.descendantNodeId),
    check('org_closure_depth_check', sql`${t.depth} >= 0`),
  ],
);
export type OrgClosureRow = typeof orgClosure.$inferSelect;

// org_sync_config
// One row per org — controls business-hours vs off-hours sync intervals,
// timezone, and how far back to sync on initial setup.

export const orgSyncConfig = pgTable('org_sync_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .unique()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('UTC'),
  businessHoursStart: text('business_hours_start').notNull().default('09:00'),
  businessHoursEnd: text('business_hours_end').notNull().default('18:00'),
  // Comma-separated ISO weekday numbers: 1=Mon … 7=Sun
  businessDays: text('business_days').notNull().default('1,2,3,4,5'),
  // Minutes between syncs during business hours (5 | 15 | 30 | 60)
  businessHoursIntervalMin: integer('business_hours_interval_min').notNull().default(5),
  // Minutes between syncs outside business hours (60 | 240 | 480 | 1440)
  offHoursIntervalMin: integer('off_hours_interval_min').notNull().default(60),
  // How many days back to sync initially; null = unlimited
  initialSyncDays: integer('initial_sync_days').default(90),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OrgSyncConfigRow = typeof orgSyncConfig.$inferSelect;

// ingestion_jobs
// One row per mailbox sync job. Server owns the queue; Collector claims rows
// via SELECT … FOR UPDATE SKIP LOCKED and reports progress back via HTTP.
//
// status transitions:
//   pending → claimed → running → done
//                               ↘ failed → (retry < max_retries) → pending
//                                         → (retry >= max_retries) → dead
//   claimed + 5 min → stale-sweeper → pending

export const jobTypeEnum = pgEnum('job_type', JOB_TYPE_VALUES);

export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    mailboxId: uuid('mailbox_id')
      .notNull()
      .references(() => mailboxes.id, { onDelete: 'cascade' }),
    jobType: jobTypeEnum('job_type').notNull().default(JobType.NewMailCheck),
    status: text('status').notNull().default('pending'), // 'pending' | 'claimed' | 'running' | 'done' | 'failed' | 'dead'
    priority: integer('priority').notNull().default(0), // higher = claimed first
    claimedBy: text('claimed_by'), // collector instance_id (hostname:pid)
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    stats: jsonb('stats')
      .$type<{ fetched?: number; accepted?: number; skipped?: number; errors?: number }>()
      .default({}),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ingestion_jobs_status_priority_idx').on(t.status, t.priority),
    index('ingestion_jobs_mailbox_idx').on(t.mailboxId),
    index('ingestion_jobs_claimed_at_idx').on(t.claimedAt),
    // At most one active job of each type per mailbox — makes "Start sync" /
    // cron enqueues idempotent. Insert sites catch the conflict and skip.
    uniqueIndex('ingestion_jobs_one_active_per_mailbox_type_idx')
      .on(t.mailboxId, t.jobType)
      .where(sql`status IN ('pending', 'claimed', 'running')`),
  ],
);

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;

// alerts
// Operational alerts surfaced on the Alerts page — written whenever a
// user-triggered action (probe, sync start, directory resync, …) fails.

export const alertSeverityEnum = pgEnum('alert_severity', ['critical', 'warning', 'info']);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    severity: alertSeverityEnum('severity').notNull(),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    source: text('source').notNull(),
    mailboxId: uuid('mailbox_id').references(() => mailboxes.id, { onDelete: 'set null' }),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('alerts_org_created_idx').on(t.orgId, t.createdAt)],
);

export type AlertRow = typeof alerts.$inferSelect;

// search_queries
// One row per natural-language search/RAG query, for reporting on query volume,
// intent breakdown, and retrieval performance over time.

export const searchQueries = pgTable(
  'search_queries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    queryText: text('query_text').notNull(),
    intent: text('intent'), // e.g. 'schedule', 'find_info', 'complaint'
    responseMs: integer('response_ms').notNull(),
    success: boolean('success').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('search_queries_org_created_idx').on(t.orgId, t.createdAt)],
);

export type SearchQueryRow = typeof searchQueries.$inferSelect;

// topics
// Aggregated knowledge topics extracted from messages, for the Knowledge
// Topics widget on Reports & Analytics.

export const topics = pgTable(
  'topics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    messageCount: integer('message_count').notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (t) => [index('topics_org_idx').on(t.orgId)],
);

export type TopicRow = typeof topics.$inferSelect;

// chat_sessions / chat_messages
// RAG chat conversations. One session per conversation thread in the UI; one
// message row per turn (user question or assistant answer). Citations point
// back at `messages.id` (RAG's email_id) — resolved to a viewable link via
// GET /documents/:id, not stored as a URL here so it stays valid even if the
// client's route structure changes later.

export type ChatCitation = {
  messageId: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  documentId: string;
  snippet: string;
};

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    messageCount: integer('message_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_sessions_user_updated_idx').on(t.userId, t.updatedAt)],
);

export type ChatSessionRow = typeof chatSessions.$inferSelect;

export const chatMessageRoleEnum = pgEnum('chat_message_role', ['user', 'assistant']);
export const chatGroundingEnum = pgEnum('chat_grounding', ['grounded', 'not_found', 'partial']);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: chatMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<ChatCitation[]>().notNull().default([]),
    grounding: chatGroundingEnum('grounding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_session_created_idx').on(t.sessionId, t.createdAt)],
);

export type ChatMessageRow = typeof chatMessages.$inferSelect;

// summaries
// Persisted AI summaries for a single message or a whole thread.
//
// Replaces the in-process Map in services/summarizer.service.ts, which loses
// every summary on restart and is not shared between server instances — so a
// two-instance deployment regenerates the same summary twice, at local-LLM cost.
//
// `ref_id` is deliberately NOT a foreign key: it points at messages.id when
// scope='email' and threads.id when scope='thread', and Postgres has no
// polymorphic FK. Deletes are handled by the org cascade above it.

export const summaryScopeEnum = pgEnum('summary_scope', ['email', 'thread']);

export const summaries = pgTable(
  'summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scope: summaryScopeEnum('scope').notNull(),
    refId: uuid('ref_id').notNull(), // messages.id | threads.id — see note above
    summary: text('summary').notNull(),
    // Staleness key, mirroring summarizer.service.ts's `${count}:${latestReceivedMs}`.
    // A thread that gains a message yields a different key, so the stored row reads
    // as stale rather than silently wrong. Compare before trusting a hit.
    sourceKey: text('source_key').notNull(),
    model: text('model').notNull(), // which local model produced it
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('summaries_scope_ref_idx').on(t.scope, t.refId),
    index('summaries_org_idx').on(t.orgId),
  ],
);

export type SummaryRow = typeof summaries.$inferSelect;
