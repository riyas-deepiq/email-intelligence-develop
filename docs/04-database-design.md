# 04 — Database Design

Four stores, each with a clear role:

| Store | Holds | Why |
|---|---|---|
| **PostgreSQL** | users, hierarchy, mailboxes, messages/threads metadata, summaries, audit, jobs, metering, policy, IdP config | Integrity-critical, relational, transactional |
| **Qdrant** | email-chunk vectors + ACL payload | Fast filtered ANN; ACL enforced at retrieval |
| **MinIO** | raw `.eml` + attachments | Durable S3-compatible blob storage |
| **Redis** | cache, queues, sessions, rate limits | Low-latency ephemeral/work-coordination |

---

## 1. PostgreSQL schema

> Dialect: PostgreSQL 16. UUID PKs (`gen_random_uuid()`), `created_at`/`updated_at` on all tables.
> Access via Prisma or Drizzle (TypeScript). Replaces the current Mongoose scaffolding.

### 1.1 Identity & hierarchy
```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT,                       -- only for native/break-glass admin
  role          TEXT NOT NULL DEFAULT 'employee'  -- 'employee' | 'admin' | 'superadmin'
                  CHECK (role IN ('employee','admin','superadmin')),
  idp_subject   TEXT,                       -- SSO subject (NULL for native)
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adjacency-list org tree (one row per person-node)
CREATE TABLE org_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manager_id  UUID REFERENCES org_nodes(id) ON DELETE SET NULL,   -- NULL = root (CEO)
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX idx_org_nodes_manager ON org_nodes(manager_id);
```

**Reporting-chain scope** (the security query) via recursive CTE — everyone at/below the asker:
```sql
WITH RECURSIVE chain AS (
  SELECT id, user_id, manager_id
  FROM org_nodes WHERE id = $askerNodeId
  UNION ALL
  SELECT c.id, c.user_id, c.manager_id          -- typo-safe: descend children
  FROM org_nodes c JOIN chain p ON c.manager_id = p.id
)
SELECT user_id FROM chain;   -- → allowed mailbox_owner_ids
```
> For large trees, an optional `org_closure` table (ancestor/descendant pairs) precomputes this for
> O(1) lookups; kept in sync via triggers on `org_nodes`.

### 1.2 Mailboxes & ingestion
```sql
CREATE TABLE mailboxes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL CHECK (provider IN ('m365','google')),
  address       CITEXT NOT NULL,
  sync_token    TEXT,                          -- Graph delta / Gmail historyId
  last_synced   TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'active',
  metered       BOOLEAN NOT NULL DEFAULT true, -- counts toward license
  UNIQUE (provider, address)
);

CREATE TABLE mailbox_credentials (              -- encrypted at rest
  mailbox_source TEXT PRIMARY KEY,              -- 'm365' | 'google' (tenant-level)
  enc_payload    BYTEA NOT NULL,                -- app creds / DWD service account
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ingestion_jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         TEXT NOT NULL CHECK (kind IN ('backfill','incremental','reconcile')),
  mailbox_id   UUID REFERENCES mailboxes(id),
  state        TEXT NOT NULL DEFAULT 'queued',  -- queued|running|done|failed
  stats        JSONB NOT NULL DEFAULT '{}',     -- fetched, deduped, indexed, errors
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ
);
```

### 1.3 Messages, threads, summaries
```sql
CREATE TABLE threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_thread_id TEXT,
  subject     TEXT,
  last_msg_at TIMESTAMPTZ
);

CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rfc_message_id  TEXT NOT NULL,                 -- dedup key
  content_hash    TEXT NOT NULL,                 -- dedup safety
  thread_id       UUID REFERENCES threads(id),
  mailbox_id      UUID NOT NULL REFERENCES mailboxes(id),
  from_addr       CITEXT,
  to_addrs        CITEXT[],
  cc_addrs        CITEXT[],
  sent_at         TIMESTAMPTZ,
  raw_object_uri  TEXT NOT NULL,                 -- MinIO key for .eml
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  language        TEXT,
  UNIQUE (rfc_message_id, mailbox_id)            -- idempotent ingest
);
CREATE INDEX idx_messages_thread ON messages(thread_id);

CREATE TABLE summaries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       TEXT NOT NULL CHECK (scope IN ('email','thread')),
  ref_id      UUID NOT NULL,                     -- message_id or thread_id
  body        JSONB NOT NULL,                    -- { text, actionItems[], participants[] }
  model_ver   TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scope, ref_id)
);
```

### 1.4 Audit, policy, metering, IdP
```sql
CREATE TABLE audit_log (                          -- append-only (no UPDATE/DELETE grants)
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id    UUID,
  actor_kind  TEXT NOT NULL,                      -- user|system|probe|ai
  event_type  TEXT NOT NULL,                      -- login|query|ai_response|admin_change|ingestion
  payload     JSONB NOT NULL,                     -- prompt, sources, target, diff, etc.
  prev_hash   TEXT, curr_hash TEXT                -- optional hash-chain (tamper-evidence)
);
CREATE INDEX idx_audit_ts ON audit_log(ts);
CREATE INDEX idx_audit_type ON audit_log(event_type);

CREATE TABLE policies (
  key   TEXT PRIMARY KEY,                          -- 'retention' | 'sensitivity'
  value JSONB NOT NULL
);

CREATE TABLE idp_config ( id INT PRIMARY KEY DEFAULT 1, protocol TEXT, config JSONB );
```

Per-mailbox metering is derived from `mailboxes WHERE metered = true AND status = 'active'`.

---

## 2. Qdrant — `email_chunks` collection

```jsonc
// Point
{
  "id": "chunk_uuid",
  "vector": [/* BGE-M3 dense */],
  "payload": {
    "message_id": "uuid",
    "thread_id": "uuid",
    "mailbox_owner_id": "uuid",        // primary ACL key
    "participant_ids": ["uuid", ...],  // for participant-aware rules (future)
    "date": "2026-03-04T09:12:00Z",
    "language": "en",
    "sensitivity": null,               // reserved (D25)
    "source_uri": "minio://attachments/...",
    "text": "chunk text for rerank/snippet"
  }
}
```

- **ACL filter** at query time: `payload.mailbox_owner_id IN aclFilter.mailboxOwnerIds`.
- Sparse/BM25 handled via Qdrant's sparse vectors or a parallel keyword index; results fused by RRF.
- Indexed payload fields: `mailbox_owner_id`, `thread_id`, `date`, `language`, `sensitivity`.

---

## 3. MinIO layout

```
raw-mail/<mailbox_id>/<rfc_message_id>.eml
attachments/<message_id>/<sha256>.<ext>
```
- Object keys are content-addressed (sha256) where possible → natural dedup.
- Versioning on; erasure coding for durability (pilot/GA).
- Access only via short-lived **presigned URLs** issued after a permission re-check.

---

## 4. Redis keys

| Pattern | Purpose | TTL |
|---|---|---|
| `sess:<sessionId>` | Session data | sliding |
| `cache:summary:thread:<id>` | Hot thread summary | minutes |
| `cache:query:<hash>` | Recent query result (per-user-scoped hash) | short |
| `rl:<userId>` | Rate-limit counters | window |
| BullMQ `ingest:*`, `process:*` | Probe job fan-out | — |

---

## 5. Actual schema (current implementation)

Migration from MongoDB → PostgreSQL is **complete** (Phase 0 done). The following tables are live:

| Table | Status | Notes |
|---|---|---|
| `users` | ✅ Live | Matches design above |
| `organizations` | ✅ Live | Added: `name`, `domains`, `admin_email`, `jit_enabled`, `jit_default_role` |
| `auth_providers` | ✅ Live | Replaces `mailbox_credentials`; stores per-provider OIDC config + AES-256-GCM encrypted secrets |
| `mailboxes` | ✅ Live | Uses `org_id` (not `owner_user_id`); adds `sync_status`, `total_messages`, `synced_messages` |
| `sessions` | ✅ Live | PgSessionStore — session_id, user_id, expires_at. Redis used only if `REDIS_URL` is set. |
| `org_nodes` | ⏳ Phase 2 | Adjacency-list org tree; required by Permission Resolver |
| `ingestion_jobs` | ⏳ Phase 1 | backfill / incremental / reconcile job tracking |
| `messages` | ⏳ Phase 1 | Email metadata, dedup keys (rfc_message_id + content_hash) |
| `threads` | ⏳ Phase 3 | Thread groupings |
| `summaries` | ⏳ Phase 3 | Per-email + incremental thread rollups (JSONB) |
| `audit_log` | ⏳ Phase 4 | Append-only; no UPDATE/DELETE grants; optional hash-chain |
| `policies` | ⏳ Phase 4 | Retention window + sensitivity rules |

### Session store priority (runtime)
```
DB_DRIVER=memory  →  MemoryStore  (tests only)
REDIS_URL set     →  RedisStore
default           →  PgSessionStore (sessions table)
```

### `organizations` table (live — not in original design)
```sql
CREATE TABLE organizations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  domains          TEXT NOT NULL,        -- comma-separated allowed domains
  admin_email      TEXT NOT NULL,
  jit_enabled      BOOLEAN NOT NULL DEFAULT false,
  jit_default_role TEXT NOT NULL DEFAULT 'employee',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `auth_providers` table (live — replaces `mailbox_credentials`)
```sql
CREATE TABLE auth_providers (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             auth_provider_type NOT NULL UNIQUE,  -- 'email_password' | 'm365' | 'google'
  enabled              BOOLEAN NOT NULL DEFAULT false,
  tenant_id            TEXT,                 -- M365 only
  client_id            TEXT,
  client_secret        TEXT,                 -- AES-256-GCM encrypted
  redirect_uri         TEXT,
  service_account_json TEXT,                 -- Google DWD; AES-256-GCM encrypted
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `sessions` table (live — PgSessionStore)
```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
```
