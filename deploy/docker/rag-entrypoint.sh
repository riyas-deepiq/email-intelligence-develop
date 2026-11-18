#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RAG container entrypoint.
#
# Compose health checks already gate on Qdrant/Postgres being *up*, but "up" and
# "ready to answer" differ by a few seconds on a cold volume, and a RAG process
# that starts against an empty Qdrant serves confident 0-hit answers instead of
# failing. So: wait, ensure collections exist (setup_qdrant.py is idempotent),
# then hand off to uvicorn via exec so signals reach it directly.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

QDRANT_HOST="${QDRANT_HOST:-qdrant}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
WAIT_TIMEOUT="${WAIT_TIMEOUT_SEC:-120}"

wait_for() {
  local label="$1" deadline=$((SECONDS + WAIT_TIMEOUT))
  shift
  until "$@" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      echo "rag-entrypoint: timed out after ${WAIT_TIMEOUT}s waiting for ${label}" >&2
      exit 1
    fi
    echo "rag-entrypoint: waiting for ${label}…"
    sleep 3
  done
  echo "rag-entrypoint: ${label} is ready"
}

wait_for "Qdrant (${QDRANT_HOST}:${QDRANT_PORT})" \
  curl -fsS "http://${QDRANT_HOST}:${QDRANT_PORT}/healthz"

# Postgres is checked through SQLAlchemy rather than pg_isready so it validates
# the actual POSTGRES_URL (driver, credentials, database name) — not just that
# something is listening on 5432.
wait_for "PostgreSQL" python -c "
from sqlalchemy import create_engine, text
from config import get_settings
create_engine(get_settings().postgres_url, pool_pre_ping=True).connect().execute(text('SELECT 1'))
"

echo "rag-entrypoint: ensuring Qdrant collections exist"
python scripts/setup_qdrant.py

# Startup only prepares the service. Completed mailbox sync jobs automatically
# call the combined Postgres ingestion endpoint; ingest_from_postgres.py remains
# available for a first-time rebuild or manual repair.
exec "$@"
