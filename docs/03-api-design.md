# 03 — API Design

Two API surfaces:
- **Core Server REST API** — public, consumed by the Web Client. Trust boundary; enforces authZ.
- **AI Service internal API** — private, called only by Core Server and Probe workers.

Conventions: JSON over HTTPS; `Authorization: Bearer <session JWT>`; ISO-8601 timestamps;
errors as `{ "error": { "code", "message", "details?" } }`; pagination via `?cursor=&limit=`.

---

## 1. Core Server REST API

### 1.1 Auth

**Native + session**
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/auth/login` | public | Native login. Body `{ email, password }`. Returns `{ tokens: { accessToken, refreshToken, expiresIn }, user }`. |
| `POST` | `/api/v1/auth/refresh` | public | Rotate token pair. Body `{ refreshToken }`. |
| `POST` | `/api/v1/auth/logout` | Bearer | Revoke session. |
| `GET` | `/api/v1/auth/me` | Bearer | Current user + role. |
| `POST` | `/api/v1/auth/setup` | Bearer (superadmin) | Complete onboarding: set org name/domains/email + new admin password. Revokes current session, issues fresh tokens. |

**OIDC / SSO**
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/auth/providers` | public | List enabled OIDC providers (for login page). |
| `GET` | `/api/v1/auth/oidc/:provider` | public | Begin OIDC flow — redirects browser to IdP authorization URL. `:provider` = `m365` \| `google`. |
| `GET` | `/api/v1/auth/oidc/callback` | public | **Server-redirect flow**: IdP returns `code+state` here; server exchanges → issues one-time login code → redirects to `{frontend}/auth/callback?code=LOGIN_CODE`. |
| `POST` | `/api/v1/auth/oidc/exchange` | public | Exchange the one-time login code for `{ tokens, user }`. Body `{ code }`. |
| `POST` | `/api/v1/auth/oidc/complete` | public | **Frontend-redirect flow**: browser received `code+state` from IdP, posts here for server-side exchange. Body `{ code, state }`. Returns `{ tokens, user }`. |

### 1.2 Users
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/users` | Bearer | List all users (any authenticated user). |
| `GET` | `/api/v1/users/:id` | Bearer | Get single user by ID. |
| `POST` | `/api/v1/users` | Bearer (admin/superadmin) | Create user. Body `{ email, displayName, role, password? }`. |
| `PATCH` | `/api/v1/users/:id` | Bearer | Update user (role, status, displayName). |

### 1.3 Auth Providers (OIDC config)
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/auth-providers` | Bearer (superadmin) | List all providers with config (secret omitted). |
| `PUT` | `/api/v1/auth-providers/:provider` | Bearer (superadmin) | Create or update provider config. `:provider` = `m365` \| `google` \| `email_password`. Validates OIDC discovery doc; encrypts secret. |

### 1.4 Organizations
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/organizations` | Bearer (superadmin) | Get org settings including JIT config. |
| `PATCH` | `/api/v1/organizations/jit` | Bearer (superadmin) | Update JIT config. Body `{ jitEnabled: boolean, jitDefaultRole: 'employee' \| 'admin' }`. |

### 1.5 Provider Connection
| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/provider-connection/test` | Bearer (superadmin) | Test credentials before connecting. Verifies Graph/Gmail API access; returns `{ valid, permissions, userCount, sampleUsers }`. |
| `POST` | `/api/v1/provider-connection/connect` | Bearer (superadmin) | Connect provider and seed mailboxes into Postgres. Body same as test + `confirmed: true`. |
| `GET` | `/api/v1/provider-connection/status` | Bearer | Get active provider status `{ connected, provider, mailboxCount, syncStatus }`. |

### 1.6 Mailboxes
| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/mailboxes` | Bearer (admin/superadmin) | List all mailboxes with sync status. |
| `POST` | `/api/v1/mailboxes` | Bearer (superadmin) | Create mailbox record manually. |
| `DELETE` | `/api/v1/mailboxes/:id` | Bearer (superadmin) | Remove mailbox. |

### 1.7 Chat *(Phase 2 — not yet implemented)*
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/chat/query` | Ask a question. Body `{ question, sessionId? }`. Returns grounded answer + citations. Streamable (SSE). |
| `GET` | `/api/v1/chat/sessions` | List the user's chat sessions. |
| `GET` | `/api/v1/chat/sessions/:id` | Get a session transcript. |
| `GET` | `/api/v1/documents/:id` | Presigned, **permission-checked** link to a source document in MinIO. |

**`POST /chat/query` response**
```json
{
  "answer": "Mr. X sent the ABC proposal on 2026-03-04 with revised pricing ...",
  "citations": [
    { "messageId": "<id>", "threadId": "<tid>", "subject": "ABC Proposal v2",
      "from": "x@acme.com", "date": "2026-03-04T09:12:00Z",
      "documentId": "doc_123", "snippet": "...revised pricing..." }
  ],
  "grounding": "grounded",
  "sessionId": "sess_789"
}
```
If unsupported: `{ "answer": "I couldn't find this in the email you have access to.", "citations": [], "grounding": "not_found" }`.

### 1.3 Admin — mailboxes & sync
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/admin/mailboxes/connect` | Connect M365 (Graph app consent) or Google (DWD). |
| `GET` | `/api/v1/admin/mailboxes` | List connected mailboxes + sync status. |
| `POST` | `/api/v1/admin/sync/start` | Trigger backfill / incremental run. |
| `GET` | `/api/v1/admin/sync/status` | Jobs, progress, throughput, failures (sync dashboard). |

### 1.4 Admin — org hierarchy
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/admin/org/tree` | Full hierarchy tree. |
| `POST` | `/api/v1/admin/org/nodes` | Create node `{ userId, managerId, title }`. |
| `PATCH` | `/api/v1/admin/org/nodes/:id` | Move/edit node (re-parent). |
| `DELETE` | `/api/v1/admin/org/nodes/:id` | Remove node (handles re-parenting of children). |
| `POST` | `/api/v1/admin/org/import` | (Post-MVP) import from IdP/HRIS. |

### 1.5 Admin — policy, audit, metering
| Method | Path | Description |
|---|---|---|
| `GET` / `PUT` | `/api/v1/admin/policies/retention` | Read/update retention window + purge rules. |
| `GET` / `PUT` | `/api/v1/admin/policies/sensitivity` | (Reserved, D25) sensitive-tag exclusion rules. |
| `GET` | `/api/v1/admin/audit` | Query append-only audit log (filter by actor/type/date). |
| `GET` | `/api/v1/admin/metering` | Active ingested-mailbox count + license status. |
| `GET` / `PUT` | `/api/v1/admin/idp` | OIDC/SAML configuration. |

---

## 2. Collector Internal API (private)

> All routes under `/v1/internal/*`. Network-restricted — Nginx blocks this prefix for all non-collector IPs.
> Auth: `Authorization: Bearer <COLLECTOR_SECRET>` on every request. No user JWT.

| Method | Path | Caller | Description |
|---|---|---|---|
| `GET` | `/v1/internal/jobs/claim` | Collector → Server | Atomically claim up to `?limit=N` pending jobs. Uses `SELECT … FOR UPDATE SKIP LOCKED`. Response includes job metadata + `instanceId` recorded as heartbeat. Does **not** include OAuth token. |
| `GET` | `/v1/internal/jobs/:id/token` | Collector → Server | Fetch decrypted provider OAuth token for one job, just-in-time. Single-use window: server marks `token_issued_at`; replays within 5 s are allowed (retry-safe), replays after that are rejected. |
| `PATCH` | `/v1/internal/jobs/:id` | Collector → Server | Update job status (`running` \| `done` \| `failed`) and stats `{ fetched, accepted, skipped, errors }`. Server updates `mailboxes.sync_status` + `sync_token` on `done`. |
| `POST` | `/v1/internal/ingest/batch` | Collector → Server | Flush a batch of messages. Body: `{ jobId, orgId, mailboxId, messages[], nextSyncToken? }`. Server deduplicates (`ON CONFLICT DO NOTHING`), upserts threads, inserts messages. Returns `{ accepted, skipped }`. Idempotent — safe to retry. |
| `GET` | `/v1/internal/collectors` | Server dashboard | List active collector instances with `last_seen`, `jobs_in_flight`, `instance_id`. |

### Job states
```
pending → claimed → running → done
                            ↘ failed (retry_count < 3) → pending
                                     (retry_count ≥ 3) → dead
claimed + 5 min timeout → stale-sweeper → pending (retry_count++)
```

### Heartbeat
Every `GET /v1/internal/jobs/claim` request records `instance_id` (collector `hostname:pid`) and `last_seen = now()`. No separate heartbeat endpoint needed.

---

## 4. RAG Service internal API (Phase 3 — not yet built)

> Network-restricted to Core Server. No employee-facing exposure.

| Method | Path | Description |
|---|---|---|
| `POST` | `/ai/parse` | Parse a document (body/attachment) → text + structure. `{ objectUri }`. |
| `POST` | `/ai/ocr` | OCR a scanned doc/image → text + language. `{ objectUri }`. |
| `POST` | `/ai/embed` | Embed chunks → vectors. `{ chunks[] }`. |
| `POST` | `/ai/index` | Full pipeline for a message: parse→ocr→chunk→embed→upsert(Qdrant)+summarize. `{ messageId }`. |
| `POST` | `/ai/summarize` | Summarize email / (re)roll-up thread. `{ messageId? , threadId? }`. |
| `POST` | `/ai/query` | **Retrieval + generation.** Body below. |

**`POST /ai/query` request**
```json
{
  "question": "give me the proposal and update Mr. X sent to ABC company",
  "aclFilter": { "mailboxOwnerIds": ["u_ceo", "u_x", "u_sales1"] },
  "userCtx": { "userId": "u_ceo", "locale": "en" },
  "topK": 8
}
```
- `aclFilter` is **mandatory** and applied inside Qdrant. A request without it is rejected.
- Returns the same answer/citations shape the Core Server relays to the client.

---

## 3. Error model & status codes
| Code | Meaning |
|---|---|
| `400` | Validation error (`error.code = "validation_error"`). |
| `401` | Missing/invalid session. |
| `403` | Authenticated but out of scope / insufficient role. |
| `404` | Resource not found **or** not permitted (avoid existence leaks). |
| `409` | Conflict (e.g., duplicate mailbox connect). |
| `422` | Unprocessable (e.g., malformed hierarchy move creating a cycle). |
| `429` | Rate-limited. |
| `500` | Internal error (sanitized; details only in audit/logs). |

---

## 4. AuthZ rules (enforced in Core Server)
- Every `/admin/*` route requires the `admin` role.
- Every `/chat/*` and `/documents/*` route resolves the caller's reporting-chain scope and passes it
  to retrieval; document links are re-checked against scope at access time.
- The `aclFilter` is built server-side from the session — **never** accepted from the client.

See [04 — Database Design](04-database-design.md) for the underlying schema and
[05 — Security Design](05-security-design.md) for the full authZ model.
