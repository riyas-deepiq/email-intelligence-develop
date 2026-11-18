# deploy/ — packaging and deployment

The container edition ships as **three installers per platform**, one per role. Install them on one
machine or on separate nodes according to the network and capacity plan.

Install the Core Server first so it can generate the shared RAG secret. Collector may be installed
before or after the server when its URL and secret are supplied explicitly.

| Role | Contains | Publishes |
|---|---|---|
| **server** | API + web client, PostgreSQL, role-local Redis | one port (default 8080) |
| **collector** | Mailbox ingestion worker | nothing — polls the server outbound |
| **rag** | RAG API, Qdrant, Ollama, role-local Redis | one protected port (default 8000) |

The full-stack [`docker-compose.yml`](docker-compose.yml) runs **one shared Redis service** for both
Server sessions and RAG/Celery, using separate key namespaces and Redis databases. One Redis is
therefore enough when all services are deployed together. The standalone Server and RAG installers
each carry a private Redis because either role may be installed on a different machine and must not
depend on the other role's container network. Do not start both role bundles merely to obtain two
Redis instances; use the full-stack Compose deployment when everything belongs on one node.

Each installer contains its images, Compose topology, configuration and installer logic, so the
target needs no container registry. Server and collector are fully offline. RAG requires model
registry access on first start unless its Ollama model volume is already seeded.

```
release/linux/  insight-hub-server-<ver>.run
                insight-hub-collector-<ver>.run
                insight-hub-rag-<ver>.run
release/win/    InsightHub-Server-Setup-<ver>.exe
                InsightHub-Collector-Setup-<ver>.exe
                InsightHub-RAG-Setup-<ver>.exe
```

Every bundle carries the same internal layout:

```
├── images/     only the images this role needs (.tar.gz)
├── compose/    docker-compose.yml — this role's services, images only
├── config/     .env.template
├── ROLE        server | collector | rag
├── MANIFEST    product, role, version, build timestamp
├── SHA256SUMS  verified before anything is installed
└── install.sh  loads images, generates secrets, registers the service, health-checks
```

## Production container topology

The full source deployment uses three networks:

- `backend` is internal-only and carries PostgreSQL, Redis, Qdrant, Ollama, RAG,
  server and collector traffic.
- `edge` connects only nginx and the server.
- `egress` gives the collector and the one-shot Ollama model puller outbound
  internet access without exposing an inbound port.

Application containers run as non-root users with a read-only root filesystem,
dropped Linux capabilities, PID limits, bounded local logs and writable `tmpfs`
mounts. Database and model images are patch-pinned; update those pins deliberately
as part of a tested release instead of pulling `latest` during deployment.

RAG reaches attachment content through `CORE_SERVER_URL=http://server:3000` on
the backend network. Do not change that to `127.0.0.1`: inside the RAG container,
loopback points back to RAG and attachment vectorization will fail.

---

## Build

```bash
./deploy/bundle/linux/build-bundle.sh --version 1.0.0                 # all roles
./deploy/bundle/linux/build-bundle.sh --version 1.0.0 --role server   # one role
./deploy/bundle/linux/build-bundle.sh --version 1.0.0 --role rag
```
```powershell
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0 -Role collector
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0 -Role rag
```

Build each platform on that platform: `docker save` needs a local daemon holding the images, the
`.run` header is a POSIX shell script, and Inno Setup only runs on Windows.

```
deploy/bundle/
├── strip-build.py     shared — derives each role's compose file (both builders call it)
├── linux/             build-bundle.sh · run-header.sh · install.sh
└── windows/           build-bundle.ps1 · insight-hub-bundle.iss · install.ps1 · uninstall.ps1
```

The Linux builder needs docker (compose v2), python3 with PyYAML, tar, gzip and sha256sum. The
Windows builder needs Docker Desktop, python with PyYAML, Inno Setup 6 (`iscc` on PATH) and
`WinSW.exe` staged under `installer\windows\staging\bin\`.

**Every role's Compose file is derived, never hand-maintained.** Both builders pass the source
[`docker-compose.yml`](docker-compose.yml) to [`strip-build.py`](bundle/strip-build.py), which keeps
runtime `${...}` expressions, selects the role services, removes `build:`, pins application images,
prunes unavailable dependencies and retains only used volumes and networks. Reading the source is
important: `docker compose config` would resolve and bake build-time placeholder secrets.

---

## Install — Linux

```bash
# On the server machine
sudo ./insight-hub-server-1.0.0.run
sudo ./insight-hub-server-1.0.0.run --port 9000     # different port

# On each collector machine — values printed by the server installer
sudo ./insight-hub-collector-1.0.0.run -- \
     --server-url http://insight-hub-server:8080 --collector-secret <value>

# On the RAG/AI machine
sudo ./insight-hub-rag-1.0.0.run -- \
     --server-url http://insight-hub-server:8080 \
     --postgres-url 'postgresql+psycopg2://user:password@postgres-host:5432/insight_hub' \
     --rag-secret <same-value-as-server-RAG_INTERNAL_SECRET>
```

Other header options: `--check` verifies checksums and prints the manifest, `--extract DIR` unpacks
without installing.

When the collector is installed on a machine that already has the server, it reads `COLLECTOR_SECRET`
from the server's config instead of asking — the same "install in either order" promise the native
packages make.

### Layout

```
/opt/insight-hub/<role>/     docker-compose.yml, MANIFEST
/etc/insight-hub/<role>/     .env (0600, all secrets) · .env.default
/var/lib/insight-hub/        postgres/  redis/
/var/log/insight-hub/        installer logs
```

Services are `insight-hub-server.service`, `insight-hub-collector.service` and `insight-hub-rag.service`.

---

## Install — Windows

Run the setup `.exe` as Administrator. The server wizard asks for a port; the collector wizard asks
for the server URL and secret; the RAG wizard asks for the Core Server URL, PostgreSQL URL, RAG
shared secret and API port.

**Prerequisite: WSL2 and a container runtime.** These are Linux containers. Setup detects a missing
Docker up front and lets you decide whether to continue installing files, rather than failing after
unpacking gigabytes.

> On licensing: Docker Desktop needs a paid subscription for larger organisations. Docker Engine
> inside WSL2, or Podman, does not. The installer works with any of them.

### Layout

```
C:\Program Files\InsightHub\            server role
C:\Program Files\InsightHub\Collector\  collector role
C:\Program Files\InsightHub\RAG\        RAG role
C:\ProgramData\InsightHub\<role>\       config\.env, logs\, postgres\, redis\
```

Services are `InsightHubServer`, `InsightHubCollector` and `InsightHubRAG`.

| | Linux | Windows |
|---|---|---|
| Service | systemd `Type=oneshot` + `compose up -d --wait` | WinSW supervising a **foreground** `compose up` |
| Config | `/etc/insight-hub/<role>/.env` (0600) | `ProgramData\...\<role>\config\.env` (SYSTEM + Administrators) |
| Logs | journald + `/var/log/...` | `ProgramData\...\<role>\logs\`, rolled at 10 MB × 8 |
| Firewall | operator's responsibility | rule added for server and RAG ports |
| Uninstall | `systemctl disable` + remove | Add/Remove Programs → `uninstall.ps1` |

The service model is the one real difference. `compose up -d` returns immediately, which Windows
reads as a crashed service, so WinSW runs `compose up` attached and stops the stack through
`<stopexecutable>`.

Each role uses a distinct Compose project name: `insight-hub-server`, `insight-hub-collector` or
`insight-hub-rag`. This prevents one installer from adopting another role's containers.

**Uninstalling keeps your data.** It removes the service, containers, that role's application image
and the firewall rule, but leaves the data directory — mail store, users, audit trail. Pass
`-RemoveData` or delete the folder by hand.

---

## Connect the RAG role

RAG reads the Core Server's authoritative PostgreSQL database and downloads attachment bytes from
the Core Server's protected internal endpoint. Both addresses must be reachable from its container.
After installing RAG, set on the server:

```
RAG_API_URL=http://<rag-node>:8000
# Keep the server's generated RAG_INTERNAL_SECRET unchanged. Compose passes it
# into the Core Server process as RAG_API_SECRET.
```

The server bundle does not publish PostgreSQL. This means a RAG role installed beside the bundled
server still needs an explicitly reachable database endpoint; container loopback is not the host and
the two role stacks do not share a Compose network. For a separate RAG node, use a private,
TLS-protected PostgreSQL endpoint or managed database restricted to the RAG host. Never expose
PostgreSQL publicly. Percent-encode reserved characters in database usernames or passwords before
putting them in the URL. The two RAG secrets must match; the query API fails closed otherwise.

Restrict inbound TCP 8000 to Core Server hosts. Authentication protects the RAG routes, but the
network rule remains an independent production control. On first start, allow the Ollama container
outbound access to its model registry, or pre-seed the `ollama_models` volume before starting RAG.

---

## Operating

```bash
systemctl status insight-hub-server
docker compose -p insight-hub-server -f /opt/insight-hub/server/docker-compose.yml ps
docker compose -p insight-hub-server -f /opt/insight-hub/server/docker-compose.yml logs -f server
systemctl status insight-hub-rag
docker compose -p insight-hub-rag -f /opt/insight-hub/rag/docker-compose.yml logs -f rag ollama-init
```

**Backups.** `pgdata` is authoritative — mail, users, audit.

```bash
docker compose -p insight-hub-server \
  -f /opt/insight-hub/server/docker-compose.yml \
  exec -T postgres pg_dump -U postgres insight_hub | gzip > insight-hub-$(date +%F).sql.gz
```

Take one before every upgrade — migrations are forward-only, so a dump is the only rollback for a
major version.

**Upgrades.** Run the new installer for each role. Images are replaced, `.env` is preserved, and the
server applies pending migrations on its first start. To roll back, re-run the previous installer.

**Scaling ingestion** is by instance: install the collector bundle on additional machines, all
pointed at the same server. Each claims a distinct batch of jobs, so two never process the same
mailbox.

---

## Development

Running from source in this directory still works and is the fastest way to iterate — this is the
full topology including RAG, Qdrant and Ollama:

```bash
cd deploy && cp .env.example .env    # fill in the required secrets
docker compose up -d --build
```

[`RAG/docker-compose.yml`](../RAG/docker-compose.yml) is separate and smaller — Qdrant + Redis only,
for local RAG development.

---

## Reverse proxy (optional)

A single-node install needs no proxy: the server binary serves the UI from its own origin on one
port, which is the whole point of [`packaging-design.md` §0C](../docs/packaging-design.md). The nginx
service exists for the four cases where that is not enough.

```bash
cd deploy
docker compose --profile proxy up -d --build     # → https://localhost (self-signed on first boot)
```

| You need | What nginx does |
|---|---|
| TLS at the edge | Terminates 443; plain 80 answers `308` to the same URL. Generates a self-signed certificate on first boot so the stack comes up before you have a real one |
| `/v1/internal/*` closed to everyone but collectors | IP allowlist ending in `deny all`, the network half of [`05-security-design.md`](../docs/05-security-design.md) — the server's `COLLECTOR_SECRET` bearer check is the other half |
| Correct client IPs | Appends the true peer to `X-Forwarded-For`. Without a proxy, `app.set('trust proxy', 1)` in [`server/src/app.ts`](../server/src/app.ts) lets any caller forge `req.ip` and walk past the auth rate limiters |
| One hostname over several nodes | Single upstream today; add `server` lines to `upstream insight-hub_server` for more |

It also gzips the JS bundle — the Node server runs no compression middleware, so nothing else does.

```
deploy/nginx/
├── entrypoint.sh                  renders config from env, generates the cert, execs nginx
├── proxy-headers.conf             shared proxy_set_header block
└── templates/
    ├── tls.conf.template          TLS_MODE=redirect — :80 redirects, :443 serves
    ├── plain.conf.template        TLS_MODE=off      — :80 serves
    └── locations.conf.template    the location table, shared by both
```

Config is **generated at container start**, not shipped fixed, because the two things that change
per site — the allowlist and whether TLS terminates here — cannot be expressed in a static file.
Editing anything under `deploy/nginx/` means rebuilding: `docker compose --profile proxy up -d --build nginx`.

### Settings

All in `deploy/.env`; see [`.env.example`](.env.example) for the annotated versions.

| | |
|---|---|
| `TLS_MODE` | `redirect` (default) or `off`. `off` is for a lab or an existing corporate terminator — never a production edge |
| `PUBLIC_HOSTNAME` | CN/SAN of the generated certificate. Wrong value = name-mismatch warning on top of the untrusted-issuer one |
| `INTERNAL_ALLOW_CIDRS` | Comma-separated, fail-closed. Default is every RFC1918 range: right for a private network, too wide for a public interface |
| `HTTP_PORT` / `HTTPS_PORT` | Host ports, default 80/443 |
| `MAX_BODY_SIZE` | Default `64m`. Must stay ≥ the 25 MB the server accepts on `/v1/internal/ingest/batch` |
| `SERVER_BIND` | **Set to `127.0.0.1` whenever the proxy is on.** Otherwise `:3000` is still reachable and every control above is bypassable |
| `CORS_ORIGIN` | The proxy's origin, e.g. `https://ei.corp.local` |

### Installing a real certificate

```bash
docker compose cp fullchain.pem nginx:/etc/nginx/tls/server.crt
docker compose cp privkey.pem   nginx:/etc/nginx/tls/server.key
docker compose --profile proxy restart nginx
```

The `nginx_tls` volume persists it and the entrypoint only generates when the files are absent, so a
restart never overwrites your certificate. For files managed on the host, replace the `nginx_tls`
volume line in [`docker-compose.yml`](docker-compose.yml) with a bind mount of a directory holding
`server.crt` and `server.key`.

### Two things to know

**The proxy is not in the role bundles.** TLS certificates, public hostnames and collector
allowlists are site-specific edge configuration, so nginx remains in the source Compose deployment.

**On Docker Desktop the allowlist sees the VM gateway, not the real client.** Every external request
arrives from one internal address, so `INTERNAL_ALLOW_CIDRS` cannot distinguish callers there. It
works as intended on Linux, where published ports are DNAT'd with the source address preserved.

---

## Not yet covered

- **Kubernetes.** No k3s manifests. The compose file is the reference topology to port from.
- **Signing.** `SHA256SUMS` proves integrity, not authenticity. Add a detached GPG or cosign
  signature, and Authenticode-sign the `.exe`, before shipping to customers who verify provenance.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `checksum verification FAILED` | Truncated or altered download — re-transfer, do not install |
| `no container runtime found` | Docker/Podman missing; the installer prints the install command |
| Collector logs 401 on every poll | `COLLECTOR_SECRET` does not match the server's. The collector stays up and reports `lastPollOk:false` rather than exiting |
| `server` restart-loops on `Cannot connect to the database` | `POSTGRES_PASSWORD` changed after the volume was initialised — it keeps the original |
| Chat returns 503 | No RAG node, or its secret does not match `RAG_API_SECRET` |
| RAG waits at `ollama-init` | The configured models are not present and the node cannot reach the Ollama model registry; allow first-start egress or pre-seed `ollama_models` |
| RAG reports PostgreSQL connection errors | `RAG_POSTGRES_URL` is unreachable from the container, uses the wrong database, or contains credentials that were not URL-encoded |
| Second role's containers vanished | Both installed with the same compose project name — check `-p insight-hub-<role>` |
| Collector 403s on `/v1/internal/*` behind the proxy | Its address is outside `INTERNAL_ALLOW_CIDRS`. `docker compose logs nginx` prints the allowlist at startup and the refused address per request |
| Chat answers arrive all at once after a long pause | Something re-enabled response buffering on `/api/v1/chat/` — that path streams SSE and needs `proxy_buffering off` |
| Browser warns the certificate is untrusted | Expected until you install a real one; the self-signed cert exists so the stack boots without one |
| `docker compose up -d` starts no nginx | It is behind a profile: `docker compose --profile proxy up -d` |
