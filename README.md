# Insight Hub


![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)
![Express](https://img.shields.io/badge/Express-4.19-000000?logo=express&logoColor=white)
![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5.3-646CFF?logo=vite&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)

> On-premise, single-tenant business intelligence platform that connects company systems to one
> **permission-aware AI knowledge layer**. Insight Hub helps employees search, understand, and act on
> trusted business data without sending it outside the customer environment.

*"Intelligence Without Boundaries."*

---

## What it does

The current release starts with corporate email and attachments. Employees ask natural-language
questions, and Insight Hub answers **only** from sources the asker is permitted to see—scoped by their
position in the organization hierarchy—and always shows its evidence.

**Flagship example.** A CEO asks: *"Give me the proposal and a summary of what Mr. X sent to ABC
company."* The UI returns the actual proposal document(s) **and** a narrative of what happened across
the thread — instantly, because summaries are precomputed during ingestion.

### Platform direction

Insight Hub is the temporary platform name, not the name of an email-only application. Email analysis is the
first production data module. The planned source ecosystem includes accounting systems such as
QuickBooks and SimpleBooks, documents, inventory and CRM data, and MCP-connected business tools.
Each connector must preserve source provenance, permissions, auditability, and grounded answers.

### Key properties
- **Privacy-first / on-prem.** No indexed business data leaves the customer perimeter. The LLM runs locally on a
  dedicated AI node (MiPhi chip), self-hosted — **no cloud LLM APIs**.
- **RAG, not training.** Knowledge lives in a vector database and is retrieved at query time, never
  baked into model weights. Fresh, auditable, and deletable.
- **Hierarchy-gated access.** A manager can see their reports' mail; peers are isolated; the CEO sees
  everything. Enforced **outside the model**, in the database.
- **Grounded answers.** Strictly source-backed, always cited, "not found" when unsupported.
- **Multilingual.** Sinhala / Tamil / Hindi / English, including OCR of scanned attachments.

---

## Architecture at a glance

```
 Web Client (React+TS) ──HTTPS──► Core Server (Node+TS) ──► PostgreSQL / Redis
        │                              │  • Auth/SSO
        │                              │  • Permission Resolver (reporting-chain)
        │                              │  • Query Orchestrator / Audit / Metering
        │                              └──/query──► AI Service (Python/FastAPI)
        │                                              │  • Parse/OCR/Embed/Summarize
 Collector (Node+TS) ──pull──► M365 Graph / Google WS  │  • Hybrid retrieve + rerank
   • Sync · Dedup · Workers                            │  • Guardrails
   └── raw blobs ──► MinIO   ◄── read docs ────────────┤
   └── enqueue ──► RabbitMQ ──process──► AI Service     └──OpenAI-compatible──► MiPhi (Qwen2.5)
                                          └── vectors ──► Qdrant (chunks + ACL)
```

Full diagrams and details in [`docs/01-architecture.md`](docs/01-architecture.md).

---

## Technology

| Layer | Stack |
|---|---|
| **Client** | React + TypeScript (Vite) |
| **Core Server** | Node.js + TypeScript |
| **Collector (ingestion)** | Node.js + TypeScript |
| **AI Service** | Python + FastAPI |
| **LLM** | Qwen2.5-Instruct on **MiPhi** chip (OpenAI-compatible API; GPU fallback for dev) |
| **Embeddings** | BGE-M3 (multilingual) |
| **Vector DB** | Qdrant |
| **Relational DB** | PostgreSQL |
| **Object store** | MinIO (S3-compatible) |
| **Cache / queue** | Redis (+ BullMQ) |
| **Broker** | RabbitMQ |
| **Parsing / OCR** | unstructured + Apache Tika / PaddleOCR |

---

## Repository map

```
insight-hub/
├── client/                 # React 18 + TypeScript (Vite) — chat UI + admin console   :8080
├── server/                 # Node.js + TypeScript — core API, auth, permissions, audit :3000
├── collector/              # Node.js + TypeScript — ingestion orchestrator + workers   :3001
├── RAG/                    # Python + FastAPI — RAG: parse, embed, retrieve, generate  :8000
├── components/             # component.json descriptor per installable unit
├── installer/              # windows/ (Inno Setup) · fpm/ (deb + rpm, systemd)
├── scripts/                # build-release.ps1 · build-release-fpm.sh
├── release/                # build output: binaries + installers            (gitignored)
└── docs/                   # Design documentation
    ├── 01-architecture.md              06-auth-provider-configuration.md
    ├── 02-system-design.md             07-deployment-guide.md
    ├── 03-api-design.md                08-development-roadmap.md
    ├── 04-database-design.md           09-infrastructure-design.md
    ├── 05-security-design.md           10-design-system.md
    ├── 11-qdrant-migration-plan.md     12-packaging.md
    └── diagrams/           # Mermaid sources (.mmd)
```

Runtime and packaging identifiers now use `insight-hub`. Installations created
under an earlier product name require an explicit service, path and database
migration before upgrading.

**Packaging:** two artifacts — the server (with the client compiled inside it) and the collector —
shipped as native installers. RAG is not packaged; it runs from source on the AI node.
See [`docs/12-packaging.md`](docs/12-packaging.md).

---

## Documentation

| Doc | Contents |
|---|---|
| [01 — Architecture](docs/01-architecture.md) | C4 views, components, responsibilities, diagrams |
| [02 — System Design](docs/02-system-design.md) | Ingestion / query / auth data flows, sync, dedup, summaries |
| [03 — API Design](docs/03-api-design.md) | Core Server REST + internal AI Service API |
| [04 — Database Design](docs/04-database-design.md) | Postgres schema, Qdrant collection, MinIO, Redis |
| [05 — Security Design](docs/05-security-design.md) | AuthN/Z, permission model, prompt-injection defense, audit |
| [06 — Infrastructure](docs/06-infrastructure-design.md) | Topology, sizing, HA/DR, MiPhi serving abstraction |
| [07 — Deployment Guide](docs/07-deployment-guide.md) | `.run` bundle, Compose → k3s, configuration, runbooks |
| [08 — Roadmap](docs/08-development-roadmap.md) | Phased delivery plan MVP → Pilot → GA |

---

## Running the project (development)

Each service runs in its own terminal as a separate process. Start them in the order below.

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | ≥ 20 | server, collector, client |
| npm | ≥ 10 | package management |
| PostgreSQL | 16 | primary database (server + RAG share it) |
| Python | ≥ 3.10 | RAG service |
| Docker + Docker Compose | any recent | Qdrant + Redis (used by RAG) |
| Ollama | any recent | embedding + LLM models, served locally |

> A local Postgres instance is the only hard requirement for the Node services.
> `DB_DRIVER=memory` (see server `.env`) skips the database entirely for quick runs of the server
> alone — but the RAG service always needs real Postgres (it reads the `messages` table directly),
> so use a real Postgres instance if you want chat/search working end-to-end.

---

### 0 — RAG service (port 8000)

Powers search/chat — parses, embeds, retrieves, and generates answers from indexed email. The Core
Server calls this directly (`server/src/modules/chat/`); there's no separate UI, it's all reached
through the client's "Search Intelligence" page. Full instructions (including ingestion, concurrency
tuning, and RBAC): [`RAG/README.md`](RAG/README.md). Quick version:

```bash
cd RAG
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env        # set POSTGRES_URL to match server's DATABASE_URL, and OLLAMA_MODEL

docker-compose up -d        # Qdrant + Redis
ollama pull nomic-embed-text
ollama pull llama3.2        # or whatever OLLAMA_MODEL is set to

python scripts/check_system.py     # verify everything's reachable
python scripts/setup_qdrant.py

uvicorn api.main:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health`

Mailbox sync automatically queues incremental RAG indexing for both mail and
attachments. For a manual repair or first-time rebuild, run:
```bash
python scripts/ingest_from_postgres.py
```
Re-run this any time — it is incremental by default and covers new/changed
messages plus newly discovered attachment files.

---

### 1 — Core Server (port 3000)

```bash
cd server

# First time
cp .env.example .env        # edit DATABASE_URL if your Postgres differs from the default
                             # also set RAG_API_URL (default http://127.0.0.1:8000) so chat/search work

npm install
```

**With a database:**
```bash
# start Postgres first, then:
npm run db:migrate            # apply pending migrations (includes chat_sessions/chat_messages)
npm run dev                   # runs tests → starts server with hot reload
```

**Without a database (memory mode):**
```bash
# in .env, set: DB_DRIVER=memory
npm run dev
```

Verify: `curl http://localhost:3000/api/v1/health`

| Script | What it does |
|---|---|
| `npm run dev` | Run tests → start with hot reload (`tsx watch`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/server.js` (production) |
| `npm run test:run` | Run all tests once |
| `npm test` | Run tests in watch mode |
| `npm run typecheck` | Type-check without building |
| `npm run db:generate` | Generate SQL migrations from `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations to the database |
| `npm run db:studio` | Open Drizzle Studio (database UI) |

---

### 2 — Collector (port 3001)

The ingestion service — downloads and deduplicates mail from M365 / Google Workspace.
Runs independently from the server. The M365 and Google connectors are fully implemented
(OAuth client-credentials, throttle-aware paging, delta/incremental sync); they need
provider credentials configured in Admin → Provider Connection before they do anything.

```bash
cd collector

# First time
cp .env.example .env        # adjust SYNC_INTERVAL_MS / WORKER_CONCURRENCY if needed

npm install
npm run dev                  # runs tests → starts collector with hot reload
```

Verify: `curl http://localhost:3001/health`  — note: **not** `/api/v1/health`; `/health` is the
collector's only inbound route.

Trigger a manual sync (with no mailboxes connected yet, returns an empty summary):
```bash
curl -X POST http://localhost:3001/api/v1/sync/run \
  -H "Content-Type: application/json" \
  -d '{"mailboxes": []}'
```

| Script | What it does |
|---|---|
| `npm run dev` | Run tests → start with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/server.js` (production) |
| `npm run test:run` | Run all tests once |
| `npm test` | Run tests in watch mode |

---

### 3 — Client (port 8080)

```bash
cd client

# First time
cp .env.example .env        # VITE_API_URL defaults to http://localhost:3000/api/v1

npm install
npm run dev                  # starts Vite dev server
```

Open: `http://localhost:8080`

In development the Vite proxy forwards `/api/*` → `http://localhost:3000`, so `VITE_API_URL`
is optional as long as the server is running.

| Script | What it does |
|---|---|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Type-check + build to `dist/` |
| `npm run test:run` | Run component/unit tests once |
| `npm test` | Run tests in watch mode |
| `npm run typecheck` | Type-check without building |

---

### Port map

| Service | Port | URL |
|---|---|---|
| Client | **8080** | `http://localhost:8080` |
| Server | **3000** | `http://localhost:3000/api/v1/health` |
| Collector | **3001** | `http://localhost:3001/health` |
| RAG | **8000** | `http://localhost:8000/health` |
| Qdrant | 6333 / 6334 | `http://localhost:6333` (via `RAG/docker-compose.yml`) |
| Redis | 6379 | (via `RAG/docker-compose.yml`) |
| Ollama | 11434 | `http://localhost:11434` |
| PostgreSQL | 5432 | shared by Server + RAG |

---

### Running tests

```bash
# server — unit + e2e tests
cd server && npm run test:run

# collector — unit + e2e tests
cd collector && npm run test:run

# client — component tests
cd client && npm run test:run

# RAG — unit + integration tests
cd RAG && source venv/bin/activate && python -m pytest tests/
```

> The `dev` script in **server** and **collector** runs the test suite before starting.
> If any test fails the server will not start.

First-run onboarding (once the auth module is wired): **bootstrap Super Admin → connect M365/Google → build org hierarchy → set retention policy → start backfill → configure SSO → invite employees.**

---

## Open action items
- Obtain **MiPhi** SDK / supported model formats + inference runtime (finalizes the serving layer).
- Legal team to handle South Asia (Sri Lanka / India) data-processing agreements.

---

## License & deployment model
On-premise, **single-tenant**, commercial license metered **per ingested mailbox**.
