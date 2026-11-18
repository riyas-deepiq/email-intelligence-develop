# Insight Hub RAG

A scalable, multi-layered Retrieval-Augmented Generation (RAG) system built to index, search, and answer questions over enterprise emails with Role-Based Access Control (RBAC).

## 🏗️ Architecture (7-Layer)

1. **`ingestion/`**: Streams emails from the Core Server's Postgres `messages` table (`pg_email_source.py`, incremental via a stored sync cursor), extracts attachments (PDF, DOCX, XLSX, images) when uploaded manually, runs OCR (via Tesseract), and chunks text. `eml_parser.py` / `ingest_single()` remain for one-off manual `.eml` uploads via the API — there is no folder-based bulk ingestion anymore.
2. **`embedding/`**: Wraps Ollama (`nomic-embed-text`) with asymmetric search prefixes (`search_document:` / `search_query:`) and retry logic.
3. **`vector_store/`**: Manages dual Qdrant collections (`email_bodies` and `email_attachments`).
4. **`retrieval/`**: Dense vector search over both collections (merged by score), then a cross-encoder (`ms-marco-MiniLM-L-6-v2`) reranks the top candidates.
5. **`llm/`**: Connects to a local Ollama LLM (`llama3.2` by default — configurable via `OLLAMA_MODEL`) and builds grounded, context-fenced prompt templates.
6. **`db/`**: RBAC bookkeeping via SQLAlchemy — `rag_users` / `rag_departments` / `rag_ingest_jobs` / `rag_sync_cursor` tables, all in the **same** Postgres database as the Core Server (prefixed `rag_` to avoid colliding with the server's own tables).
7. **`api/`**: FastAPI backend with streaming endpoints. There is no standalone UI here anymore — the Core Server (`server/src/modules/chat/`) calls this API directly and the actual chat UI lives in the client app (`client/src/features/chat/`), reached via the dashboard's "Search Intelligence" nav item.

---

## ✅ Prerequisites

Install these before you start:

| Tool | Why | Check it's installed |
|---|---|---|
| **Python 3.10+** | Runs the RAG service | `python3 --version` |
| **Docker + Docker Compose** | Runs Qdrant + Redis | `docker --version` |
| **Ollama** | Serves the embedding + LLM models locally | `ollama --version` |
| **PostgreSQL access** | Same database the Core Server writes emails into | ask for the `DATABASE_URL` used in `server/.env` |
| **Tesseract OCR** *(optional)* | Only needed for OCR on image attachments | Ubuntu: `sudo apt install tesseract-ocr` · macOS: `brew install tesseract` |

---

## 🚀 Step-by-Step: Running From Scratch

### 1. Create and activate a virtual environment
```bash
cd RAG
python3 -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
```

### 2. Install dependencies
```bash
pip install -r requirements-dev.txt
```

### 3. Configure environment variables
```bash
cp .env.example .env
```
Then edit `.env`:
- **`POSTGRES_URL`** — must point at the *same* database the Core Server uses. Take the server's `DATABASE_URL` (from `server/.env`, format `postgres://user:pass@host:5432/dbname`) and rewrite it with the SQLAlchemy driver prefix: `postgresql+psycopg2://user:pass@host:5432/dbname`.
- **`OLLAMA_MODEL`** — set to whichever chat model you've actually pulled (e.g. `llama3.2`). Check what you have with `ollama list`.
- Everything else (Qdrant host/port, chunk size, retrieval params) has sane defaults — leave as-is unless you know you need to change it.

There is no SQLite fallback — Postgres is the only backend this system talks to, so this step is not optional.

### 4. Start infrastructure (Qdrant + Redis)
```bash
docker-compose up -d
```
This starts Qdrant on `:6333`/`:6334` and Redis on `:6379`. Confirm both are healthy:
```bash
docker-compose ps
```

### 5. Pull the required Ollama models
```bash
ollama pull nomic-embed-text
ollama pull llama3.2          # or whatever OLLAMA_MODEL is set to
```
*(The reranker model, `cross-encoder/ms-marco-MiniLM-L-6-v2`, downloads automatically from HuggingFace the first time the API runs a query — no manual step needed.)*

### 6. Run the health check
```bash
python scripts/check_system.py
```
This verifies Qdrant, Ollama (and that both models are actually pulled), PostgreSQL connectivity, Redis, Tesseract, and Python dependencies in one shot. Fix anything marked ❌ before continuing — it'll save you a confusing failure two steps from now.

### 7. Create the Qdrant collections
```bash
python scripts/setup_qdrant.py
```
Idempotent — safe to re-run. Use `--recreate` to drop and rebuild both collections from scratch (you'll lose all indexed vectors).

### 8. Ingest mail and attachments from Postgres
```bash
python scripts/ingest_from_postgres.py
```
This creates RAG's own tables (`rag_departments`, `rag_users`, `rag_ingest_jobs`, `rag_sync_cursor`) on first run, then processes both message bodies and attachment content into Qdrant. It is **incremental by default** with independent safe cursors for messages and files. Normal mailbox sync queues this workflow automatically; the command is for first-time setup and repair.

Useful flags:
| Flag | Effect |
|---|---|
| `--mailbox-id <uuid>` / `--org-id <uuid>` | Scope to a single mailbox/org (doesn't touch the global sync cursor) |
| `--since <ISO-8601>` | Ingest only messages updated after this timestamp |
| `--full-resync` | Ignore both stored cursors and rescan all mail and known attachments |
| `--clear` | Recreate both Qdrant collections before ingesting |
| `--workers N` | Mail/files processed concurrently (default: `INGEST_MAX_WORKERS` from `.env`, `4`) |

**Concurrency**: each email's chunk→embed→upsert step runs in a thread pool (`--workers`). This is I/O-bound work (HTTP calls to Ollama + Qdrant), so Python's GIL is released while waiting and threads give real wall-clock speedup — going much above Ollama's own `OLLAMA_NUM_PARALLEL` (default `4`) just queues requests on Ollama's side without extra throughput, so there's rarely a reason to set `--workers` far past that. If *any* message fails during a run, the sync cursor isn't advanced at all — the next run retries the whole window from the same starting point (safe, since re-ingesting an already-succeeded message just overwrites its Qdrant points rather than duplicating them).

### 9. Start the backend API
```bash
uvicorn api.main:app --reload --port 8000
```
Visit `http://localhost:8000/docs` for interactive Swagger docs, or `http://localhost:8000/health` for a live status check.

This is the **only** thing you run on the RAG side — there's no separate UI process. The Core Server calls this API directly (`server/src/modules/chat/`), and the actual chat interface is the client app's "Search Intelligence" page. Start the Core Server and client per their own READMEs to use it end-to-end.

### 10. Try it out
Directly against RAG (manual/standalone testing — no mailbox scoping, uses RAG's own `rag_users` table via `user_id`):
```bash
curl -X POST http://localhost:8000/api/v1/query/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "What did the last email from the PM say?", "user_id": 1}'
```
Or end-to-end through the real stack: log into the client app and open **Search Intelligence** in the sidebar — the Core Server resolves your real access scope (`getScopedMailboxIds`) and passes it as `mailbox_ids` on every request, so RAG never needs to know who you are.

---

## 🛡️ Role-Based Access Control (RBAC)

There are **two independent scoping mechanisms**, and every query uses exactly one of them:

**1. Mailbox-scoped (the real integration path — `mailbox_ids` in the request).** The Core Server resolves a user's actual access via `getScopedMailboxIds()` (their own mailbox + org-hierarchy reports' mailboxes, or every mailbox for admins) and passes that list on every call. RAG trusts it directly and filters Qdrant on `mailbox_id` — an empty list means "see nothing," not "no filter." RAG never authenticates the caller itself; the Core Server already did that with the user's real session before it ever calls RAG. This is what `server/src/modules/chat/` uses, end to end.

**2. Department/role-based (standalone/manual testing only — `user_id` in the request, `mailbox_ids` omitted).** Falls back to RAG's own tiny `rag_users`/`rag_departments` tables (`db/seed.py`) and a three-tier scheme: **Executive** sees everything, **Department Head** sees their department + personal emails, **Employee** sees only emails where they're the sender/recipient. Useful for `curl`/Swagger testing without a running Core Server, but it's a hand-seeded fixture, not real identity — don't point production traffic at it.

Either way, filtering happens **inside the Qdrant query itself** — restricted chunks never leave the vector store, let alone reach the LLM. Department tagging (used by path 2) comes from `mailboxes.department_name` — the mail provider's synced directory profile — joined in at ingestion time; `threads.participant_emails` is merged into the recipient list so being anywhere in a conversation counts as access, not just being directly To/Cc'd on one message.

An optional shared secret (`RAG_INTERNAL_SECRET` / Core Server's `RAG_API_SECRET`) guards `/api/v1/query/*` against being called by anything other than the Core Server — unset by default for local dev, set it in any environment reachable from outside your own machine.

---

## 🛠️ Developer Scripts

- **`python scripts/check_system.py`** — health check on Qdrant, Redis, PostgreSQL, Ollama, Tesseract, and Python deps.
- **`python scripts/setup_qdrant.py [--recreate]`** — create/reset Qdrant collections.
- **`python scripts/ingest_from_postgres.py [flags]`** — ingest mail and attachments from Postgres (see step 8 above).
- **`python -m pytest tests/`** — run the unit/integration test suite.

## 🩹 Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `check_system.py` shows `messages table: NO MESSAGES FOUND` | The Collector hasn't synced any mailboxes into Postgres yet — nothing to ingest until it has. |
| Ingestion runs but upserts 0 chunks | Check `POSTGRES_URL` actually points at the Core Server's database, not an empty local one. |
| `ModuleNotFoundError` for `pydantic_settings` / `qdrant_client` / `python_multipart` | Your venv wasn't fully set up — re-run `pip install -r requirements-dev.txt` inside the activated venv. |
| LLM answers are generic / ignore email content | Confirm `OLLAMA_MODEL` in `.env` matches a model you've actually pulled (`ollama list`), and that ingestion has actually run (check Qdrant point counts via `/health`). |
| Re-running ingestion seems to duplicate results | Only affects the manual `/upload` single-file endpoint today — the Postgres path (`ingest_from_postgres.py`) already de-duplicates safely. |
| Chat page in the client shows an error / empty responses | Check the Core Server can actually reach RAG: `RAG_API_URL` in the server's `.env` must point at wherever `uvicorn api.main:app` is running (default `http://127.0.0.1:8000`), and — if you've set `RAG_INTERNAL_SECRET` — the server's `RAG_API_SECRET` must match it exactly. |
