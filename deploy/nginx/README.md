# Nginx edge proxy

This directory contains the optional Nginx reverse proxy for the Insight Hub Core
Server. It is the public entry point when a deployment needs HTTPS or additional
network controls. It is not required for a basic single-node installation, and
it is not part of the RAG service.

## Responsibilities

Nginx provides:

- TLS termination and HTTP-to-HTTPS redirects.
- An IP allowlist for the collector endpoint under `/v1/internal/*`.
- Trusted forwarding headers and the real client IP for server rate limiting.
- Unbuffered Server-Sent Events for streamed chat responses.
- Gzip compression for the client application and API responses.
- Request-size and upstream timeout limits appropriate for ingestion and chat.

The Core Server continues to serve both the React client and API. Nginx only
forwards requests to it; it does not host a separate frontend application.

## Starting the proxy

Nginx uses the `proxy` Compose profile and does not start during a normal
`docker compose up` operation.

From the repository root:

```bash
docker compose -f deploy/docker-compose.yml --profile proxy up -d --build
```

The default endpoints are:

- `http://localhost` redirects to HTTPS.
- `https://localhost` serves Insight Hub.
- `/healthz` reports the health of Nginx itself.

When the proxy is enabled, keep `SERVER_BIND=127.0.0.1` so clients cannot bypass
TLS and the internal endpoint allowlist by connecting directly to the Core
Server port.

## Configuration

Configure the proxy in `deploy/.env`:

| Variable | Purpose | Default |
|---|---|---|
| `TLS_MODE` | `redirect` enables HTTPS; `off` serves plain HTTP | `redirect` |
| `PUBLIC_HOSTNAME` | Hostname used for the generated certificate | `insight-hub.local` |
| `INTERNAL_ALLOW_CIDRS` | Addresses allowed to call `/v1/internal/*` | Private network ranges |
| `MAX_BODY_SIZE` | Maximum proxied request size | `64m` |
| `HTTP_PORT` | Published HTTP port | `80` |
| `HTTPS_PORT` | Published HTTPS port | `443` |

Use `TLS_MODE=off` only for local testing or when another trusted proxy already
terminates TLS. Production logins and tokens should not travel over plain HTTP.

## Certificates

On first start, Nginx creates a self-signed certificate when no certificate is
present. Browsers will warn about it. Replace it with a certificate issued by
the customer's trusted certificate authority:

```bash
docker compose -f deploy/docker-compose.yml cp fullchain.pem nginx:/etc/nginx/tls/server.crt
docker compose -f deploy/docker-compose.yml cp privkey.pem nginx:/etc/nginx/tls/server.key
docker compose -f deploy/docker-compose.yml --profile proxy restart nginx
```

The `nginx_tls` volume preserves certificates across container restarts.

## Relationship to Collector and RAG

Collector requests to `/v1/internal/*` pass through the IP allowlist and still
require the server's `COLLECTOR_SECRET`. Both controls must succeed.

RAG does not pass through this Nginx proxy. RAG downloads protected attachment
content directly from the Core Server using `CORE_SERVER_URL`, while the Core
Server calls RAG using `RAG_API_URL`. Do not expose the RAG API publicly; permit
its port only from Core Server hosts.

## Directory contents

```text
nginx/
├── README.md
├── entrypoint.sh
├── proxy-headers.conf
└── templates/
    ├── locations.conf.template
    ├── plain.conf.template
    └── tls.conf.template
```

- `entrypoint.sh` validates environment values, builds the allowlist, creates
  initial TLS material and renders the selected configuration.
- `proxy-headers.conf` defines the shared forwarding and connection headers.
- `locations.conf.template` defines health, collector, chat and general routes.
- `tls.conf.template` enables HTTPS; `plain.conf.template` is the HTTP-only
  alternative.
