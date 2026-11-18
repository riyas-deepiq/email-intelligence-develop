# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────────────────────
# Collector image — mail ingestion worker (:3001).
#
# The collector is outbound-only: it polls the server for jobs and posts results
# back over SERVER_URL. Its single inbound route is GET /health (see
# collector/src/app.ts) — do not publish this port beyond monitoring.
#
# Build context is the REPOSITORY ROOT:
#   docker build -f deploy/docker/collector.Dockerfile .
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22.23.0-alpine3.23 AS build
WORKDIR /build/collector

COPY collector/package.json collector/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY collector/tsconfig.json collector/tsconfig.build.json ./
COPY collector/src ./src
RUN npm run build


FROM node:22.23.0-alpine3.23 AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache tini

COPY collector/package.json collector/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --chown=node:node --from=build /build/collector/dist ./dist

USER node
EXPOSE 3001

# /health answers 200 even when the last poll failed ("degraded") — a server
# outage is not a collector fault, and 5xx here would restart-loop a healthy
# process. Alert on `status: "degraded"` in the body instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]
