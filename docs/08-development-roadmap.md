# 08 — Development Roadmap

Phased delivery from the current scaffolding to a pilot-ready product. Phases are sequenced so each
builds a usable slice; security controls land alongside the features they protect.

---

## Phase 0 — Foundation ✅ COMPLETE
**Goal:** project skeleton, data layer, auth shell.
- ✅ Restructured repo: `client/`, `server/`, `collector/`, `ai-service/`, `deploy/`, `docs/`.
- ✅ **PostgreSQL + Drizzle ORM** (MongoDB removed entirely); `users`, `organizations`, `auth_providers`, `mailboxes`, `sessions` tables live.
- ✅ Core Server in TypeScript: config, health, error handling, structured compact logging.
- ✅ Auth: native bootstrap Super Admin + JWT (15 min access token + 7-day refresh token); PgSessionStore.
- ✅ Admin Web Client shell: Dashboard, sidebar nav, topbar, settings, overview.
- ⚠️ Infra Compose: Postgres only — Qdrant, MinIO, Redis, RabbitMQ not yet in docker-compose.

**Exit criteria met:** Super Admin can log in; migrations run; Postgres healthy.

---

## Phase 1 — Ingestion ⚠️ IN PROGRESS
**Goal:** mail flowing into the platform, idempotently.

**Done:**
- ✅ Collector service skeleton: scheduler, connector factory, M365 + Google connectors, DedupService (in-memory).
- ✅ **Mailbox connection UI + API**: admin connects M365 (admin consent) or Google (DWD); provider validated, credentials encrypted (AES-256-GCM), mailboxes seeded into Postgres.
- ✅ **OIDC / SSO** (M365 + Google) and **JIT provisioning** with domain allowlist — moved up from Phase 4 because it was needed for the admin flow.
- ✅ Setup wizard (3-step onboarding): org config → admin password → provider connection.
- ✅ Provider status API (`GET /api/v1/provider-connection/status`).

**Pending:**
- ⏳ `ingestion_jobs` table — backfill/incremental/reconcile job state + stats.
- ⏳ `messages` + `threads` tables — email metadata; RFC Message-ID dedup against Postgres (currently in-memory only; resets on restart).
- ⏳ **MinIO integration** — persist raw `.eml` + attachments; `raw-mail/<mailbox_id>/<rfc_message_id>.eml`.
- ⏳ **RabbitMQ pipeline** — collector publishes `process` jobs; AI Service consumes.
- ⏳ **BullMQ worker pool** — fan-out mailbox jobs across workers (50 mailboxes → 5×10).
- ⏳ **Delta/history token persistence** — save `syncToken` per mailbox after each run (column exists, not written yet).
- ⏳ **Sync dashboard** — per-mailbox progress, job queue depth, failures, throughput.
- ⏳ **Disconnect provider** — UI + API to remove a connected M365/Google provider.
- ⏳ **Infra Compose** — add Qdrant, MinIO, Redis, RabbitMQ to `docker-compose.yml`.

**Near-term UX (blocking real users):**
- ⏳ Forgot Password / Reset Password flow.
- ⏳ Change Password (Settings → Security tab).
- ⏳ User management: edit role, deactivate/reactivate user.
- ⏳ Settings → Security, Notifications, Data & Privacy tabs.

**Exit:** connect a mailbox → backfill + incremental sync with no duplicates; sync dashboard shows progress.

---

## Phase 2 — AI core (RAG)
**Goal:** grounded, permission-filtered answers.
- AI Service (FastAPI): parse (unstructured/Tika), **OCR** (PaddleOCR), language detect.
- Chunk → **embed (BGE-M3)** → upsert to **Qdrant** with ACL payload.
- **Permission Resolver** in Core Server (recursive CTE) → ACL filter.
- **Hybrid retrieval** (BM25 + dense) → RRF → **cross-encoder rerank**.
- Grounded prompt construction + **MiPhi** call (via OpenAI-compatible adapter; GPU fallback for dev).
- Guardrails: injection defense + grounded-only + **citations**.

**Exit:** an employee asks a question and gets a cited answer scoped to their reporting chain.

---

## Phase 3 — Summaries & UX
**Goal:** the flagship "show me the proposal + what happened" experience.
- Hierarchical summarization: per-email → **incremental thread rollups** (Postgres JSONB + Redis cache).
- Chat UI: streamed answers, **citation cards**, document preview/download (permission-checked).
- **Org-hierarchy tree builder** (create/move/delete nodes).
- Action-item extraction surfaced in summaries (lightweight).

**Exit:** flagship query returns proposal document(s) + narrative summary instantly.

---

## Phase 4 — Security, governance & licensing
**Goal:** enterprise-readiness.

**Done (moved up to Phase 1):**
- ✅ OIDC/SSO — Microsoft 365 + Google (both server-redirect and frontend-redirect flows).
- ✅ JIT provisioning with email domain allowlist + superadmin-controlled default role.
- ✅ Credentials encrypted at rest (AES-256-GCM, `OIDC_ENCRYPTION_KEY`).

**Pending:**
- ⏳ Full **append-only audit log** (`audit_log` table: no UPDATE/DELETE grants; optional hash-chain for tamper-evidence) + admin audit viewer UI.
- ⏳ **Configurable retention** window + cascade purge across all stores (Postgres, Qdrant, MinIO, summaries, cache); per-person purge.
- ⏳ **Per-mailbox metering** + license enforcement (`mailboxes.metered` column exists; enforcement logic pending).
- ⏳ Encryption hardening: at-rest volume encryption, Postgres RLS, presigned MinIO link re-check at access time.
- ⏳ Break-glass MFA for superadmin.
- ⏳ SAML SSO (OIDC done; SAML not yet implemented).

**Exit:** passes an internal security review; metering/licensing operational.

---

## Phase 5 — Pilot hardening
**Goal:** run at mid-range scale with resilience.
- **k3s HA**: replicas, Postgres replication, Qdrant replication, MinIO erasure coding, RabbitMQ quorum.
- **DR**: backups + restore drills (RPO ≤ 1h / RTO ≤ 4h).
- Near-real-time **push sync** where networks allow + reconciliation sweeps.
- Performance/sizing tuning; summarization throughput budgeting.
- **MiPhi integration** finalized against vendor SDK/runtime.
- `.run` installer + upgrade path polished.

**Exit:** pilot deployment serving 500–5,000 users with HA/DR and acceptable latency.

---

## Cross-cutting (every phase)
- Tests (unit/integration) for the **Permission Resolver** and ACL filtering — highest-risk path.
- CI builds per component; reproducible container images.
- Documentation kept in sync with `docs/`.

---

## Open action items (external dependencies)
- **MiPhi SDK / runtime + supported model formats** — finalizes the serving adapter (Phase 2 dev uses GPU fallback; Phase 5 finalizes).
- **Legal**: South Asia (Sri Lanka / India) data-processing agreements.

---

## Decision traceability
All phase scope traces to discovery decisions **D1–D26** captured during the discovery process
(self-hosted LLM, M365/Google, reporting-chain access, RAG-not-training, hybrid search, grounded-only,
layered injection defense, Postgres+Qdrant+MinIO+Redis, per-mailbox licensing, configurable retention,
single-tenant, k3s HA + DR, MiPhi serving).
