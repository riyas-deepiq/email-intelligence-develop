# Insight Hub — Complete Deployment Guide

This guide covers the three customer deployment modes currently supported by
the repository. Windows and Linux packages are platform variants of the same
mode, not additional deployment methods. Use one mode per role on a production
host; do not install both its native and container package on the same host.

The product display name is Insight Hub. Existing `insight-hub-*` package names,
service identifiers, paths and environment-variable names remain unchanged for
upgrade compatibility.

## 1. Customer deployment modes and current status

| Mode | Customer artifacts | Server | Collector | RAG | Status |
|---|---|---:|---:|---:|---|
| Full-stack Docker Compose | Compose project | Included | Included | Included | Implemented |
| Separate container role installers | Windows `.exe` or Linux `.run` for each role | Separate | Separate | Separate | Implemented |
| Native Server and Collector | Windows `.exe` or Linux `.deb`/`.rpm` | Separate | Separate | Use the container RAG installer | Implemented |

The source-based workflow later in this guide is for development and support,
not customer deployment. An all-in-one full-stack Windows `.exe` or Linux
`.run` is also not currently implemented. The closest complete option is the
full-stack Docker Compose deployment.

### 1.1 Separate container role installer experience

The separate-container mode creates three installers for each target platform:

| Platform | Server | Collector | RAG |
|---|---|---|---|
| Windows | `InsightHub-Server-Setup-<version>.exe` | `InsightHub-Collector-Setup-<version>.exe` | `InsightHub-RAG-Setup-<version>.exe` |
| Linux | `insight-hub-server-<version>.run` | `insight-hub-collector-<version>.run` | `insight-hub-rag-<version>.run` |

The Windows setup wizard asks for the required URL, port and secrets, then
loads the bundled images, writes the role configuration, registers the Windows
service, configures the required firewall rule and performs a health check.
The Linux `.run` package verifies and extracts itself, loads the bundled images,
writes the role configuration, registers a systemd service and performs the
same health check.

This is intended to be straightforward for a customer, but it is not a
dependency-free one-click installer:

- Docker Desktop with WSL2 on Windows, or Docker Engine with Compose v2 on
  Linux, must already be installed and running.
- Install the Server first. The Collector and RAG installers need the matching
  Server URL and shared secrets.
- The separate RAG host needs private network access to the authoritative
  PostgreSQL database used by the Server.
- The first RAG start needs model-registry access unless the Ollama models are
  pre-seeded.
- Before client delivery, run the generated packages on clean Windows and Linux
  virtual machines. Repository-level checks alone do not prove the complete
  customer installation path.

## 2. Ports

| Port | Used by | Exposure |
|---:|---|---|
| 80/443 | Optional Nginx edge | User-facing when proxy is enabled |
| 3000 | Full-stack Core Server | User-facing only when Nginx is disabled |
| 8080 | Bundled/native Core Server default | User-facing |
| 3001+ | Native Collector health endpoints | Loopback only |
| 8000 | Separate RAG role | Permit only from Core Server hosts |
| 5432 | PostgreSQL | Private network only |
| 6333/6334 | Qdrant | Internal only |
| 6379 | Redis | Internal only |
| 11434 | Ollama | Internal only |

Never expose PostgreSQL, Redis, Qdrant or Ollama to the public internet.

## 3. Required secrets

| Variable | Shared between | Requirement |
|---|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL clients | Unique deployment value |
| `JWT_SECRET` | Core Server only | At least 32 characters |
| `OIDC_ENCRYPTION_KEY` | Core Server only | Exactly 64 lowercase hexadecimal characters |
| `COLLECTOR_SECRET` | Core Server and every Collector | Values must be identical |
| `RAG_INTERNAL_SECRET` | Core Server and RAG | Compose passes the server copy as `RAG_API_SECRET` |
| `SEED_ADMIN_PASSWORD` | First administrator | Change immediately after first login |

Do not place real secrets in source-controlled files. If a password contains
reserved URL characters, percent-encode it before placing it in a PostgreSQL URL.

---

# Method A — Full-stack Docker Compose

Use this method when all roles run on one machine. It is the simplest complete
deployment and uses one shared Redis service.

## A1. Prerequisites

- Linux host or Windows host with WSL2.
- Docker Engine/Desktop with Compose v2.
- Sufficient disk for container images, PostgreSQL, Qdrant and Ollama models.
- Outbound access to Microsoft/Google provider APIs.
- First-start access to the Ollama model registry, unless models are pre-seeded.

Verify:

```bash
docker version
docker compose version
```

## A2. Create configuration

From the repository root:

```bash
cp deploy/.env.example deploy/.env
```

On PowerShell:

```powershell
Copy-Item deploy\.env.example deploy\.env
```

Open `deploy/.env` and fill every required secret. At minimum configure:

```dotenv
POSTGRES_PASSWORD=<generated-value>
JWT_SECRET=<generated-value-at-least-32-characters>
OIDC_ENCRYPTION_KEY=<64-lowercase-hex-characters>
COLLECTOR_SECRET=<generated-shared-value>
RAG_INTERNAL_SECRET=<generated-shared-value>
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=<temporary-strong-password>
SERVER_BIND=0.0.0.0
SERVER_PORT=3000
CORS_ORIGIN=http://<server-host>:3000
EMBED_MODEL_NAME=nomic-embed-text
OLLAMA_MODEL=llama3.2
```

Use `SERVER_BIND=127.0.0.1` instead when Nginx runs on the same host.

## A3. Validate and start

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

The first start can take a long time because `ollama-init` pulls the embedding
and chat models before RAG becomes ready.

## A4. Verify

```bash
curl -fsS http://127.0.0.1:3000/api/v1/health
docker compose --env-file deploy/.env -f deploy/docker-compose.yml exec -T rag \
  curl -fsS http://127.0.0.1:8000/health
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs --tail=100 server collector rag ollama-init
```

Open `http://<server-host>:3000`, sign in with the seeded administrator, change
the password, complete organization/provider setup and then set:

```dotenv
SEED_DEFAULT_ADMIN=false
```

Restart the server after changing configuration:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d server
```

## A5. Enable Nginx and HTTPS

Set in `deploy/.env`:

```dotenv
SERVER_BIND=127.0.0.1
CORS_ORIGIN=https://insight-hub.example.com
TLS_MODE=redirect
PUBLIC_HOSTNAME=insight-hub.example.com
INTERNAL_ALLOW_CIDRS=<collector-host-cidrs>
HTTP_PORT=80
HTTPS_PORT=443
```

Start the proxy profile:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  --profile proxy up -d --build
curl -fsS http://127.0.0.1/healthz
```

Nginx creates a self-signed certificate on first start. Replace it with the
customer's certificate:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  cp fullchain.pem nginx:/etc/nginx/tls/server.crt
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  cp privkey.pem nginx:/etc/nginx/tls/server.key
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  --profile proxy restart nginx
```

See [`deploy/nginx/README.md`](../deploy/nginx/README.md) for proxy details.

## A6. Backup

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml \
  exec -T postgres pg_dump -U postgres insight_hub | gzip > insight-hub-backup.sql.gz
```

Also preserve `deploy/.env` securely and back up the Qdrant and Ollama volumes
when rebuilding the vector index or re-downloading models is unacceptable.

## A7. Upgrade

1. Back up PostgreSQL.
2. Copy the new source release to the host.
3. Compare `deploy/.env.example` with the existing `deploy/.env`.
4. Validate and rebuild:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml config --quiet
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

## A8. Stop or remove

Stop while preserving containers and data:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml stop
```

Remove containers while preserving named volumes:

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
```

Do not use `down --volumes` unless the installation is being permanently
decommissioned and verified backups exist.

---

# Method B — Separate container role installers

Use these installers when Server, Collector and RAG run on different machines,
or when each role must be upgraded independently.

## B1. Build Linux role installers

Build on Linux with Docker Compose v2, Python 3 with PyYAML, `tar`, `gzip` and
`sha256sum` installed:

```bash
./deploy/bundle/linux/build-bundle.sh --version 1.0.0
```

Build one role only:

```bash
./deploy/bundle/linux/build-bundle.sh --version 1.0.0 --role server
./deploy/bundle/linux/build-bundle.sh --version 1.0.0 --role collector
./deploy/bundle/linux/build-bundle.sh --version 1.0.0 --role rag
```

Outputs:

```text
release/linux/insight-hub-server-1.0.0.run
release/linux/insight-hub-collector-1.0.0.run
release/linux/insight-hub-rag-1.0.0.run
```

## B2. Install the Linux Server role

Transfer the file to the Server host and verify its embedded checksums:

```bash
chmod +x insight-hub-server-1.0.0.run
./insight-hub-server-1.0.0.run --check
sudo ./insight-hub-server-1.0.0.run
```

Use another published port if required:

```bash
sudo ./insight-hub-server-1.0.0.run -- --port 9000
```

Server configuration and secrets:

```text
/etc/insight-hub/server/.env
```

Record `COLLECTOR_SECRET` and `RAG_INTERNAL_SECRET` securely. They are required
by the other roles.

## B3. Install a Linux Collector role

```bash
chmod +x insight-hub-collector-1.0.0.run
./insight-hub-collector-1.0.0.run --check
sudo ./insight-hub-collector-1.0.0.run -- \
  --server-url http://<server-host>:8080 \
  --collector-secret '<COLLECTOR_SECRET-from-server>'
```

Verify:

```bash
systemctl status insight-hub-collector
docker compose -p insight-hub-collector \
  -f /opt/insight-hub/collector/docker-compose.yml logs -f collector
```

A running Collector is not sufficient: confirm that its health/log data reports
`lastPollOk=true`. A 401 means the shared secret does not match.

## B4. Prepare PostgreSQL for a separate RAG role

RAG reads the same authoritative database as the Core Server. The Server bundle
does not publish its bundled PostgreSQL port. Therefore a separate RAG role needs
one of these:

- a private managed PostgreSQL endpoint;
- a customer-managed PostgreSQL server reachable from both roles; or
- an explicitly secured private PostgreSQL listener restricted to the RAG host.

Never publish PostgreSQL to the public internet.

## B5. Install the Linux RAG role

```bash
chmod +x insight-hub-rag-1.0.0.run
./insight-hub-rag-1.0.0.run --check
sudo ./insight-hub-rag-1.0.0.run -- \
  --server-url http://<server-host>:8080 \
  --postgres-url 'postgresql+psycopg2://user:encoded-password@db-host:5432/insight_hub' \
  --rag-secret '<RAG_INTERNAL_SECRET-from-server>' \
  --rag-port 8000
```

First start requires Ollama model-registry access unless the model volume has
already been seeded. Restrict inbound port 8000 to Core Server hosts.

Verify:

```bash
systemctl status insight-hub-rag
docker compose -p insight-hub-rag -f /opt/insight-hub/rag/docker-compose.yml \
  logs -f rag ollama-init
curl -fsS http://127.0.0.1:8000/health
```

On the Server host, edit `/etc/insight-hub/server/.env`:

```dotenv
RAG_API_URL=http://<rag-host>:8000
```

Keep the existing `RAG_INTERNAL_SECRET` unchanged, then restart:

```bash
sudo systemctl restart insight-hub-server
```

## B6. Build Windows role installers

Build on Windows with Docker, Python/PyYAML, Inno Setup 6 and the tracked
`installer\windows\staging\service\WinSW.exe` file:

```powershell
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0
```

Or build selected roles:

```powershell
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0 -Role server
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0 -Role collector
.\deploy\bundle\windows\build-bundle.ps1 -Version 1.0.0 -Role rag
```

Outputs:

```text
release\win\InsightHub-Server-Setup-1.0.0.exe
release\win\InsightHub-Collector-Setup-1.0.0.exe
release\win\InsightHub-RAG-Setup-1.0.0.exe
```

## B7. Install Windows container roles

1. Install WSL2 and Docker Desktop/Engine.
2. Run `InsightHub-Server-Setup-1.0.0.exe` as Administrator.
3. Record the generated secrets from
   `C:\ProgramData\InsightHub\server\config\.env`.
4. Run the Collector setup and enter the Server URL and `COLLECTOR_SECRET`.
5. Prepare a private PostgreSQL endpoint reachable by RAG.
6. Run the RAG setup and enter the Server URL, SQLAlchemy PostgreSQL URL,
   `RAG_INTERNAL_SECRET` and RAG port.
7. Set `RAG_API_URL` in the Server role `.env` and restart `InsightHubServer`.

Verify:

```powershell
Get-Service InsightHubServer,InsightHubCollector,InsightHubRAG
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
Invoke-RestMethod http://127.0.0.1:8000/health
```

## B8. Upgrade and uninstall role bundles

- Upgrade by running the newer installer for the same role. Existing `.env` and
  persistent data are retained.
- Windows roles can be removed independently through Apps & Features.
- Linux container roles currently have no packaged uninstall command. Stop and
  disable the matching `insight-hub-<role>` service, run the role Compose `down`, and
  retain `/etc/insight-hub/<role>` plus `/var/lib/insight-hub` until backups are verified.

---

# Native deployment — Windows Server and Collector

This method produces native Node executables. It does not package RAG, Qdrant,
Redis or Ollama.

## C1. Prerequisites

- Windows x64 build host.
- Node.js and npm.
- Inno Setup 6 (`iscc.exe`).
- `installer\windows\staging\service\WinSW.exe`.
- A PostgreSQL 16 endpoint for the installed Server.

## C2. Prepare configuration before release

Review:

```text
installer/windows/config/server.env
installer/windows/config/client.env
installer/windows/config/collector.env
```

Do not ship the example administrator password. Set a strong temporary value or
disable default seeding according to the customer onboarding process. Confirm
`DATABASE_URL`, ports and public origin expectations.

## C3. Build

```powershell
.\scripts\build-release.ps1 -Version 1.0.0
```

For binaries without compiling installers:

```powershell
.\scripts\build-release.ps1 -Version 1.0.0 -SkipInstaller
```

The complete build creates:

```text
release\win\insight-hub-server.exe
release\win\insight-hub-collector.exe
release\win\InsightHub-Server-Setup.exe
release\win\InsightHub-Collector-Setup.exe
```

Sign the binaries before installer compilation and sign the final installers
before customer delivery.

## C4. Install

1. Install PostgreSQL and create/restrict the application account.
2. Run the Server setup as Administrator.
3. Edit the installed Server configuration if the database URL is site-specific:

```text
C:\Program Files\InsightHub\config\server\.env
```

4. Restart and verify the Server:

```powershell
Restart-Service InsightHub
Invoke-RestMethod http://127.0.0.1:8080/api/v1/health
```

5. Run the Collector setup on the same or another host.
6. For a remote Collector, set `SERVER_URL` and copy the exact
   `COLLECTOR_SECRET` from the Server configuration.
7. Verify:

```powershell
Get-Service InsightHub,InsightHubCollector1
Invoke-RestMethod http://127.0.0.1:3001/health
```

Confirm `lastPollOk=true` before declaring the installation complete.

## C5. Add Collector instances

```powershell
Set-Location 'C:\Program Files\InsightHub\Collector\scripts'
.\add-collector.ps1 -Instance 2
.\add-collector.ps1 -Instance 3 -Concurrency 5
```

## C6. Add RAG to a native installation

Native packages do not include RAG. Deploy the separate RAG container role using
Method B, give it the native Server URL and PostgreSQL URL, then set these values
in the native Server configuration:

```dotenv
RAG_API_URL=http://<rag-host>:8000
RAG_API_SECRET=<same-value-as-RAG_INTERNAL_SECRET-on-RAG>
```

Restart `InsightHub` and test a permission-scoped query.

## C7. Upgrade or uninstall

- Run the newer Server or Collector setup to upgrade that product.
- Configuration and data are preserved by default.
- Use Apps & Features to uninstall each product independently.
- Removing the Server does not remove the external PostgreSQL database.

---

# Native deployment — Linux `.deb` and `.rpm`

This method packages native Server and Collector binaries as operating-system
packages. RAG remains a separate deployment.

## D1. Build prerequisites

- Node.js 20+ and npm.
- Linux build host for packaging.
- Ruby and FPM.
- `dpkg-deb` for `.deb` packages.
- `rpmbuild` for `.rpm` packages.

## D2. Prepare configuration

Review before building:

```text
installer/fpm/config/server.env
installer/fpm/config/client.env
installer/fpm/config/collector.env
```

Replace the example administrator password and confirm the expected PostgreSQL
URL. The package installer generates JWT, OIDC and Collector secrets on the
target host.

## D3. Build packages

```bash
./scripts/build-release-fpm.sh --version 1.0.0
```

Build only one package format:

```bash
./scripts/build-release-fpm.sh --version 1.0.0 --deb-only
./scripts/build-release-fpm.sh --version 1.0.0 --rpm-only
```

Expected outputs:

```text
release/linux/packages/insight-hub-server_1.0.0-1_amd64.deb
release/linux/packages/insight-hub-collector_1.0.0-1_amd64.deb
release/linux/packages/insight-hub-server-1.0.0-1.x86_64.rpm
release/linux/packages/insight-hub-collector-1.0.0-1.x86_64.rpm
```

## D4. Install the Server package

Debian/Ubuntu:

```bash
sudo apt install ./insight-hub-server_1.0.0-1_amd64.deb
```

RHEL/Rocky/Alma/Fedora:

```bash
sudo dnf install ./insight-hub-server-1.0.0-1.x86_64.rpm
```

Configure and restart:

```bash
sudo editor /etc/insight-hub/server/.env
sudo systemctl restart insight-hub
systemctl status insight-hub
curl -fsS http://127.0.0.1:8080/api/v1/health
```

Generated secrets are stored separately at:

```text
/etc/insight-hub/server/secrets.env
```

## D5. Install a local Collector

```bash
sudo apt install ./insight-hub-collector_1.0.0-1_amd64.deb
# or
sudo dnf install ./insight-hub-collector-1.0.0-1.x86_64.rpm
```

The package copies the local Server URL and shared secret when the Server is on
the same host.

## D6. Install a remote Collector

Create the join file before installing:

```bash
sudo mkdir -p /etc/insight-hub
sudo editor /etc/insight-hub/collector-join.env
```

Contents:

```dotenv
SERVER_URL=http://<server-host>:8080
COLLECTOR_SECRET=<value-from-server-secrets.env>
```

Install and verify:

```bash
sudo apt install ./insight-hub-collector_1.0.0-1_amd64.deb
systemctl status insight-hub-collector@1
curl -fsS http://127.0.0.1:3001/health
```

## D7. Add Collector instances

```bash
sudo /usr/lib/insight-hub/collector/add-collector.sh 2
sudo /usr/lib/insight-hub/collector/add-collector.sh 3 --concurrency 5
systemctl status insight-hub-collector@2
```

## D8. Add RAG

Use Method B's RAG container role or run RAG from source. Configure the native
Server with `RAG_API_URL` and a `RAG_API_SECRET` that matches RAG's
`RAG_INTERNAL_SECRET`, then restart `insight-hub`.

## D9. Upgrade and remove

Upgrade:

```bash
sudo apt install ./insight-hub-server_1.1.0-1_amd64.deb
# or
sudo dnf upgrade ./insight-hub-server-1.1.0-1.x86_64.rpm
```

Remove while retaining configuration on Debian/Ubuntu:

```bash
sudo apt remove insight-hub-server insight-hub-collector
```

Purge package configuration:

```bash
sudo apt purge insight-hub-server insight-hub-collector
```

RPM removal:

```bash
sudo dnf remove insight-hub-server insight-hub-collector
```

`/var/lib/insight-hub` and the external PostgreSQL database are not automatically
deleted.

---

# Development only — Source deployment

This method is for development and troubleshooting, not client production.

1. Install Node dependencies in `client`, `server` and `collector`.
2. Create each service's `.env` from its `.env.example`.
3. Install Python dependencies from `RAG/requirements.txt`.
4. Start PostgreSQL, Qdrant, Redis and Ollama.
5. Start RAG, Server, Collector and Client using their README commands.

Prefer Method A for a reproducible full local environment.

---

# Final production acceptance checklist

- [ ] Selected exactly one deployment method per role and host.
- [ ] Removed old generated files from `release/` before the final build.
- [ ] Built all artifacts from the intended commit and version.
- [ ] Signed Windows executables/installers and Linux packages where required.
- [ ] Replaced every example password and rotated any credential exposed in source or editor settings.
- [ ] Restricted PostgreSQL, Redis, Qdrant, Ollama and RAG network access.
- [ ] Installed a trusted TLS certificate for user-facing traffic.
- [ ] Changed the seeded administrator password and disabled default reseeding.
- [ ] Completed Microsoft 365 or Google provider configuration.
- [ ] Verified Collector `lastPollOk=true`.
- [ ] Verified RAG health, ingestion, attachment download and a permission-scoped query.
- [ ] Tested backup creation and documented restore ownership.
- [ ] Recorded configuration paths, service names and support log locations for the client.

## Related references

- [`deploy/README.md`](../deploy/README.md) — container topology and role bundles.
- [`deploy/nginx/README.md`](../deploy/nginx/README.md) — reverse proxy and TLS.
- [`12-packaging.md`](my%20docs/12-packaging.md) — native packaging overview.
- [`building-executables.md`](my%20docs/building-executables.md) — executable build internals.
- [`installer/windows/README.md`](../installer/windows/README.md) — native Windows installer details.
- [`installer/fpm/README.md`](../installer/fpm/README.md) — native Linux package details.
- [`RAG/README.md`](../RAG/README.md) — RAG configuration and operations.
