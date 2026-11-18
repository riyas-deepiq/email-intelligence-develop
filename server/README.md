# Insight Hub Core Server

Node.js and TypeScript service responsible for authentication, authorization,
organization scope, mailbox administration, ingestion orchestration, audit
records, and permission-aware access to the RAG service.

## Folder structure

```text
server/
├── drizzle/                   Database migrations and metadata
├── public/                    Compiled React client used by packaged builds
├── scripts/
│   └── bundle-client.mjs      Client packaging script
├── src/
│   ├── cli/                   Provisioning and administration commands
│   │   └── commands/
│   ├── config/                Environment-file loading and runtime configuration
│   ├── db/                    Drizzle schema, PostgreSQL client, retry, and seed logic
│   ├── lib/                   Shared utilities and infrastructure contracts
│   ├── middleware/            Authentication, errors, logging, and static client
│   ├── modules/               Feature-oriented API modules
│   ├── routes/                API router composition
│   ├── services/              Cross-module application services
│   ├── app.ts                 Express application composition
│   ├── cli.ts                 CLI entry point
│   └── server.ts              HTTP bootstrap and graceful shutdown
├── tests/
│   ├── unit/                  Unit and focused integration tests
│   └── e2e/                   End-to-end HTTP tests
├── .env.example               Configuration template
├── package.json               Scripts and dependencies
├── tsconfig.json              TypeScript validation configuration
├── tsconfig.build.json        Production build configuration
└── vitest.config.ts           Test configuration
```

## Architecture

Feature modules follow this structure where applicable:

```text
<feature>.routes.ts
<feature>.controller.ts
<feature>.service.ts
<feature>.repository.ts
<feature>.repository.pg.ts
<feature>.schema.ts
<feature>.types.ts
```

- Routes compose middleware and dependencies.
- Controllers handle HTTP input and output.
- Services contain business rules.
- Repositories enforce persistence, ownership, and access boundaries.
- Authorization scope is resolved by the Core Server before calling RAG.
- Repository factories provide PostgreSQL and in-memory implementations.

## Requirements

- Node.js 20 or later
- PostgreSQL for production
- Redis when distributed persistent sessions are required
- Collector service for mailbox synchronization
- RAG service for search and chat

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

Default API address: `http://localhost:3000/api/v1`

Health endpoint: `GET /api/v1/health`

## Validation

```bash
npm run check
npm run test:unit
npm run test:e2e
npm run test:coverage
npm run build
```

`npm run check` runs TypeScript validation, ESLint, and the complete test suite.

## Important configuration

- `DB_DRIVER=memory` enables DB-less development and tests.
- `DATABASE_URL` configures PostgreSQL.
- `JWT_SECRET` signs access and refresh tokens.
- `OIDC_ENCRYPTION_KEY` encrypts stored OAuth credentials.
- `REDIS_URL` enables Redis-backed sessions.
- `COLLECTOR_URL` and `COLLECTOR_SECRET` configure Collector communication.
- `RAG_API_URL` and `RAG_API_SECRET` configure RAG communication.

Never commit customer data, credentials, or local `.env` files.

## Database

`src/db/schema.ts` is the application schema. Migrations are committed under
`drizzle/`.

```bash
npm run db:generate
npm run db:migrate
npm run db:studio
```

The PostgreSQL hierarchy integration test is opt-in because it creates and
removes real database records:

```powershell
$env:RUN_PG_INTEGRATION = "1"
npm.cmd run test:run -- tests/unit/modules/org-hierarchy/org-hierarchy.repository.pg.test.ts
```

## Packaging

```bash
npm run package:win
npm run package:linux
npm run package:all
```

The packaging workflow builds the server and embeds the compiled React client
from `client/dist`.
