# Insight Hub Collector

Node.js and TypeScript worker responsible for Microsoft 365 and Google Workspace
mail ingestion. It claims jobs from the Core Server, streams normalized message
batches, and reports job progress and health.

The Collector does not connect directly to PostgreSQL or the RAG service.

## Folder structure

```text
collector/
├── src/
│   ├── clients/
│   │   └── core-server.client.ts  Authenticated Core Server communication
│   ├── config/                    Environment loading and validation
│   ├── connectors/                Provider contracts and mail connectors
│   ├── jobs/                      Polling, processing, buffering, and job types
│   ├── observability/             Structured logging
│   ├── scheduling/                Business-hours polling calculations
│   ├── app.ts                     Health endpoint application
│   └── server.ts                  Process startup and graceful shutdown
├── tests/                         Unit and HTTP endpoint tests
├── .env.example                  Environment template
├── package.json                  Scripts and dependencies
├── tsconfig.json                 TypeScript validation configuration
├── tsconfig.build.json           Production build configuration
└── vitest.config.mts             Test and coverage configuration
```

## Architecture

- The poller claims jobs atomically from the Core Server.
- Provider connectors expose a common streaming contract.
- Mailbox pages are processed incrementally to keep memory usage bounded.
- Message buffers flush by count, size, or age.
- Job heartbeats allow abandoned work to be detected and recovered.
- Provider throttling and expired cursors use explicit retry behavior.
- Microsoft Graph incremental synchronization is Inbox-scoped.
- The initial backfill captures all configured folders.

## Requirements

- Node.js 20 or later
- A running Insight Hub Core Server
- Microsoft 365 or Google Workspace credentials configured through the server

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Default health address: `http://localhost:3001/health`

`GET /health` is the Collector's only inbound HTTP endpoint.

## Validation and build

```bash
npm run check
npm run test:run
npm run test:coverage
npm run build
```

`npm run check` runs TypeScript validation, ESLint, and the complete test suite.

## Important configuration

- `SERVER_URL` configures the Core Server address.
- `COLLECTOR_SECRET` must match the Core Server secret.
- `COLLECTOR_INSTANCE_ID` optionally sets a stable worker identity.
- `POLL_INTERVAL_MS` controls job polling.
- `WORKER_CONCURRENCY` limits concurrent mailbox jobs.
- `JOB_HEARTBEAT_MS` controls in-flight job heartbeats.
- `FLUSH_MAX_MESSAGES`, `FLUSH_MAX_SIZE_MB`, and `FLUSH_MAX_AGE_MS`
  control batch delivery.

Environment values are validated at startup. Never commit provider credentials,
customer data, or local `.env` files.

## Packaging

```bash
npm run package:win
npm run package:linux
```

Packaged binaries load external configuration through
`src/config/env-file.ts`.
