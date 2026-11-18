# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Core Server image — API + bundled web UI on a single port (:3000).
#
# The client is NOT a separate container. `scripts/bundle-client.mjs` copies the
# built Vite output into server/public, from where staticClientRouter serves it
# at runtime — the same "one service, one port" model the packaged binary uses
# (docs/packaging-design.md §0C). That script also refuses to bundle a client
# build containing hard-coded localhost URLs, so the check still runs here.
#
# Build context is the REPOSITORY ROOT (it needs both client/ and server/):
#   docker build -f deploy/docker/server.Dockerfile .
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build the web client ───────────────────────────────────────────
FROM node:22.23.0-alpine3.23 AS client-build
WORKDIR /build/client

COPY client/package.json client/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY client/ ./
# client/.env.production pins VITE_API_URL=/api/v1 so the bundle calls its own
# origin. Vite inlines that at build time — never override it with an absolute URL.
RUN npm run build


# ── Stage 2: compile the server and bundle the client into it ───────────────
FROM node:22.23.0-alpine3.23 AS server-build
WORKDIR /build/server

COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
COPY server/scripts ./scripts
RUN npm run build

COPY --from=client-build /build/client/dist /build/client-dist
RUN node scripts/bundle-client.mjs --client-dist /build/client-dist


# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22.23.0-alpine3.23 AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini

COPY server/package.json server/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --chown=node:node --from=server-build /build/server/dist ./dist
COPY --chown=node:node --from=server-build /build/server/public ./public
# Drizzle migrations must sit at <app>/drizzle — db/client.ts resolves them
# relative to dist/ (__dirname/../../drizzle) and applies them on startup.
COPY --chown=node:node server/drizzle ./drizzle

USER node
EXPOSE 3000

# checkDbConnection() runs before the listener binds, so a passing health check
# also means Postgres is reachable and migrations have been applied.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
