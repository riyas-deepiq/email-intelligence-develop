# =============================================================================
# api/internal_auth.py — Shared-secret guard for server-to-server calls
# =============================================================================
"""
Bearer-secret dependency for routes that should only be called by the Core
Server (not end users directly) — mirrors the Core Server's own
COLLECTOR_SECRET pattern for the collector-to-server channel.

FAIL-CLOSED. If RAG_INTERNAL_SECRET is unset, /query/* refuses to serve at all
(503) instead of serving to anyone who can reach the port. This matters because
the query routes scope results purely by the caller-supplied mailbox_ids list —
there is no second identity check behind them, so an unguarded port is a full
read of every indexed mailbox.

For local dev / Swagger testing, set RAG_ALLOW_INSECURE_INTERNAL=true to opt
back into the old no-op behaviour. That flag must never be set anywhere the
port is reachable from another machine.
"""
from __future__ import annotations

import logging
import secrets

from fastapi import Header, HTTPException

from config import settings

logger = logging.getLogger(__name__)


async def require_internal_secret(authorization: str = Header(default="")) -> None:
    if not settings.rag_internal_secret:
        if settings.rag_allow_insecure_internal:
            logger.warning(
                "RAG_INTERNAL_SECRET is unset and RAG_ALLOW_INSECURE_INTERNAL=true — "
                "/query/* is UNAUTHENTICATED. Local development only."
            )
            return
        logger.error(
            "Refusing query: RAG_INTERNAL_SECRET is not configured. Set it here and as "
            "RAG_API_SECRET in the Core Server's .env, or set RAG_ALLOW_INSECURE_INTERNAL=true "
            "for local development."
        )
        raise HTTPException(
            status_code=503,
            detail="RAG internal auth is not configured; refusing to serve query requests.",
        )

    # Constant-time compare — a plain != leaks the secret a byte at a time to
    # anyone able to measure response timing across many attempts.
    if not secrets.compare_digest(authorization, f"Bearer {settings.rag_internal_secret}"):
        raise HTTPException(status_code=401, detail="Invalid or missing internal secret")
