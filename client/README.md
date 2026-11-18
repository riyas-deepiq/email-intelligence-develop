# Insight Hub Client

React and TypeScript frontend for Insight Hub. The client provides search, chat,
mailbox management, organization administration, monitoring, and setup
interfaces backed by the Core Server API.

## Folder structure

```text
client/
├── src/
│   ├── app/                    Application shell, routing, and providers
│   ├── assets/                 Source images and static assets
│   ├── features/               Feature-oriented pages, APIs, and components
│   │   ├── alerts/
│   │   ├── audit/
│   │   ├── auth/
│   │   ├── chat/
│   │   ├── dashboard/
│   │   ├── mailboxes/
│   │   ├── messages/
│   │   ├── org-hierarchy/
│   │   ├── organizations/
│   │   ├── provider-connection/
│   │   ├── roles/
│   │   ├── setup/
│   │   ├── sync/
│   │   └── users/
│   ├── shared/
│   │   ├── api/                Shared HTTP client and API contracts
│   │   ├── components/         Reusable interface components
│   │   ├── hooks/              Shared React hooks
│   │   ├── toast/              Notification infrastructure
│   │   ├── types/              Shared TypeScript types
│   │   └── utils/              Shared utilities
│   └── styles/                 Design tokens and application styles
├── .env.example               Environment template
├── .env.production            Production build configuration
├── eslint.config.js           ESLint configuration
├── index.html                 Vite HTML entry point
├── package.json               Scripts and dependencies
├── tsconfig.json              TypeScript configuration
└── vite.config.ts             Vite development and build configuration
```

## Architecture

- Features own their pages, components, API calls, and types.
- Shared infrastructure is kept under `src/shared`.
- Server data is managed through TanStack Query.
- HTTP requests use the shared Axios client.
- Application routes use React Router.
- Styling uses shared CSS tokens and supports light and dark themes.
- Authorization remains enforced by the Core Server.

## Requirements

- Node.js 20 or later
- A running Insight Hub Core Server

## Setup

```bash
cp .env.example .env
npm install
npm run dev
```

Development address: `http://localhost:8080`

The Vite development server proxies `/api` requests to
`http://localhost:3000`.

## Validation and build

```bash
npm run check
npm run build
npm run preview
```

`npm run check` runs TypeScript validation and ESLint. Production assets are
written to `dist/`.

## Important configuration

- `VITE_API_URL` configures the Core Server API base URL.
- `VITE_SUPPORT_EMAIL` configures the support address displayed by the client.
- Only variables prefixed with `VITE_` are exposed to browser code.

The production build uses a relative API path so the Core Server can safely
embed and serve the compiled client.
