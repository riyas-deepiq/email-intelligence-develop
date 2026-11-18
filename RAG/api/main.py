# =============================================================================
# api/main.py — FastAPI application entry point
# =============================================================================
"""
Start with:
    source /home/hackgodx/Projects/RP/venv/bin/activate
    uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from typing import Any, Dict

import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes import emails, ingest, query
from config import settings
from db.session import check_db_connection, init_db
from vector_store.qdrant_client import EmailQdrantClient

logger = logging.getLogger(__name__)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialise resources on startup, release on shutdown."""
    logger.info("🚀 Insight Hub RAG API starting up…")

    # DB
    try:
        init_db()
        from db.seed import seed
        seed()
        logger.info("✅ PostgreSQL ready")
    except Exception as exc:
        logger.warning("PostgreSQL unavailable (%s) — continuing without DB", exc)

    # Qdrant collections
    try:
        qdrant = EmailQdrantClient()
        qdrant.ensure_collections()
        logger.info("✅ Qdrant collections ready")
    except Exception as exc:
        logger.warning("Qdrant unavailable (%s)", exc)

    # Pre-warm models in background (non-blocking)
    def _prewarm():
        try:
            from embedding.nomic_embedder import get_embedder
            get_embedder()
            logger.info("✅ Embedding model warmed up")
        except Exception as exc:
            logger.warning("Embedding warm-up failed: %s", exc)
            
        try:
            from retrieval.reranker import Reranker
            Reranker()
            logger.info("✅ Reranker model warmed up")
        except Exception as exc:
            logger.warning("Reranker warm-up failed: %s", exc)
            
        try:
            from llm.ollama_client import get_llm_client
            get_llm_client().warm_up()
            logger.info("✅ LLM warmed up")
        except Exception as exc:
            logger.warning("LLM warm-up failed: %s", exc)

    threading.Thread(target=_prewarm, daemon=True).start()

    yield

    logger.info("🛑 Insight Hub RAG API shutting down")


# ── App ────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Insight Hub RAG API",
    description=(
        "RBAC-filtered semantic search and RAG over company emails, "
        "powered by Qdrant + Ollama + nomic-embed-text."
    ),
    version="2.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(emails.router)


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"], summary="System health check")
async def health() -> Dict[str, Any]:
    # Qdrant
    qdrant_status: Dict[str, Any] = {"ok": False}
    try:
        client = EmailQdrantClient()
        info   = client.get_collection_info()
        qdrant_status = {"ok": True, "collections": info}
    except Exception as exc:
        qdrant_status = {"ok": False, "error": str(exc)}

    # Ollama
    ollama_status: Dict[str, Any] = {"ok": False}
    try:
        r = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        ollama_status = {"ok": True, "models": models}
    except Exception as exc:
        ollama_status = {"ok": False, "error": str(exc)}

    # DB
    db_status = {"ok": check_db_connection()}

    return {
        "status":   "ok",
        "qdrant":   qdrant_status,
        "ollama":   ollama_status,
        "database": db_status,
        "model":    settings.ollama_model,
    }


@app.get("/", tags=["system"])
async def root():
    return {
        "service": "Insight Hub RAG API",
        "version": "2.0.0",
        "docs":    "/docs",
    }
