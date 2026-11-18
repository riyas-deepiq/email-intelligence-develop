# 07 — Deployment Guide

How Insight Hub is packaged, installed, configured, and operated on-premise.

---

## 1. Packaging — the `.run` offline bundle

Each component is built separately, then shipped as a **containerized offline bundle** wrapped in a
self-extracting `.run` installer. This gives a single-binary install feel while keeping the Node +
Python + native-OCR dependencies reproducible.

```
insight-hub-<version>.run
└── (self-extracts to)
    ├── images/                 # saved container images (.tar)
    │   ├── client-server.tar
    │   ├── probe.tar
    │   ├── ai-service.tar
    │   └── infra/{postgres,qdrant,minio,redis,rabbitmq}.tar
    ├── compose/                # Docker Compose (MVP)
    ├── k3s/                    # k3s manifests / Helm (pilot/GA)
    ├── config/                 # .env templates, policy defaults
    └── install.sh              # loads images, runs migrations, starts services
```

**Builds**
1. **Frontend + Core Server** (built separately, co-deployed as the app unit).
2. **Probe** (ingestion orchestrator + workers).
3. **AI Service** (Python).
4. **Model** — deployed separately on the **MiPhi AI node**.

---

## 2. Prerequisites

| Requirement | MVP | Pilot/GA |
|---|---|---|
| App host | 1 Linux node, Docker + Compose | k3s cluster |
| AI node | 1 MiPhi node (or NVIDIA GPU for dev) | MiPhi node pool |
| Outbound internet | Mail provider APIs + model/package pulls | same |
| Inbound | Web Client/ingress port only | ingress only |
| Provider setup | M365 app (`Mail.Read`) consented; Google DWD service account | same |

---

## 3. Install — MVP (Docker Compose)

```bash
# 1. Run the installer (loads images, prepares config)
sudo ./insight-hub-<version>.run

# 2. Configure
cp config/.env.example config/.env
#   set: DB creds, MinIO keys, MIPHI_BASE_URL, session secret, mail provider IDs

# 3. Start infrastructure + apps
docker compose -f compose/docker-compose.yml up -d

# 4. Run DB migrations (Prisma/Drizzle)
docker compose exec core-server npm run migrate:deploy

# 5. Verify
curl -fsS http://localhost:8080/health
```

Then open the Web Client and complete **first-run onboarding** (§5).

---

## 4. Install — Pilot / GA (k3s)

```bash
# Load images into the cluster registry, then:
kubectl apply -k k3s/overlays/prod      # or: helm install insight-hub k3s/chart -f values.prod.yaml
```
Enables replicas, Postgres streaming replication, Qdrant replication, MinIO erasure coding, RabbitMQ
quorum queues, and ingress/TLS. See [06 — Infrastructure](06-infrastructure-design.md).

---

## 5. First-run onboarding

1. **Bootstrap Super Admin** — native login; set a strong password + MFA (break-glass thereafter).
2. **Connect mail** — M365 (admin consent) and/or Google (domain-wide delegation).
3. **Build org hierarchy** — tree-view builder (CEO at root; reports beneath).
4. **Set policies** — retention window (and reserved sensitivity rules).
5. **Start backfill** — watch progress on the sync dashboard.
6. **Configure SSO** — OIDC/SAML; map IdP → users.
7. **Invite employees** — they log in via SSO.

---

## 6. Configuration reference (key env vars)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection |
| `QDRANT_URL` | Qdrant endpoint |
| `MINIO_ENDPOINT` / `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Object store |
| `REDIS_URL` | Cache / queues / sessions |
| `RABBITMQ_URL` | Job broker |
| `MIPHI_BASE_URL` | OpenAI-compatible model endpoint (or GPU fallback) |
| `SESSION_SECRET` | Session/JWT signing |
| `RETENTION_DAYS` | Default retention policy |
| `LICENSE_FILE` | Per-mailbox license key/limits |

---

## 7. Operational runbooks

| Task | Action |
|---|---|
| **Health check** | `GET /health` on Core Server + AI Service; queue depth on RabbitMQ |
| **Backup** | Postgres PITR + base; Qdrant snapshot; MinIO replicate; export config — ship off-box |
| **Restore (DR)** | Restore Postgres → Qdrant → MinIO; replay config; verify counts; smoke test query (target RTO ≤ 4h) |
| **Re-sync mailbox** | `POST /admin/sync/start` (incremental or backfill) |
| **Reprocess after model upgrade** | Trigger background reprocess job (bounded by mailbox/date range) |
| **Rotate secrets** | Update `mailbox_credentials` / env; restart affected services |
| **Scale (pilot)** | Increase Core Server / AI Service / Probe replicas; add MiPhi node |
| **Purge user data** | Cascade purge across Postgres + Qdrant + MinIO + summaries + cache |

---

## 8. Upgrades
- Pull new `.run`, load images, run migrations (`migrate:deploy`), rolling-restart services.
- Backward-compatible migrations; DB backup taken before each upgrade.
- Model-version bumps tracked in `summaries.model_ver`; reprocess only if required.
