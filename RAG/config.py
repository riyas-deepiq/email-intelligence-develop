# =============================================================================
# config.py — Centralised configuration (env-var backed via pydantic-settings)
# =============================================================================
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Qdrant ────────────────────────────────────────────────────────────────
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    collection_bodies: str = "email_bodies"
    collection_attachments: str = "email_attachments"
    vector_size: int = 768

    # ── Ollama ────────────────────────────────────────────────────────────────
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_timeout: int = 1200
    embed_model_name: str = "nomic-embed-text"
    ollama_model: str = "llama3.2"

    # ── PostgreSQL (Cloud) ────────────────────────────────────────────────────
    postgres_url: str = "postgresql+psycopg2://user:password@localhost:5432/insight_hub"

    # ── Redis / Celery ────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/0"
    celery_result_backend: str = "redis://localhost:6379/1"

    # ── Data paths ────────────────────────────────────────────────────────────
    # Extracted attachment files are saved here — only reached via the manual
    # /upload single-.eml endpoint (ingest_single()); the Postgres bulk path
    # never has attachment bytes, only metadata, so it never writes here.
    attachments_folder: str = "./data/attachments"

    # ── Chunking ─────────────────────────────────────────────────────────────
    chunk_size: int = 400
    chunk_overlap: int = 50
    embed_batch_size: int = 4
    max_body_chars: int = 100_000

    # ── Ingestion concurrency ──────────────────────────────────────────────────
    # How many emails to chunk/embed/upsert concurrently during
    # ingest_from_postgres(). I/O-bound (Ollama + Qdrant HTTP calls), so this
    # gives real speedup. Going above Ollama's own OLLAMA_NUM_PARALLEL
    # (default 4) just queues requests server-side without extra throughput.
    ingest_max_workers: int = 4

    # ── Retrieval ─────────────────────────────────────────────────────────────
    top_k_results: int = 3
    rerank_top_k: int = 5
    hybrid_top_k: int = 20
    score_threshold: float = 0.3

    # ── Reranker ──────────────────────────────────────────────────────────────
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    # ── FastAPI ───────────────────────────────────────────────────────────────
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # ── Internal service-to-service auth ───────────────────────────────────────
    # Shared secret guarding /api/v1/query/* (mirrors the Core Server's
    # COLLECTOR_SECRET pattern). Set the SAME value here and as RAG_API_SECRET
    # in the Core Server's .env.
    #
    # This is the ONLY thing standing between the query API and the network:
    # /query/* returns email content scoped purely by the mailbox_ids the
    # caller passes, so anyone who can reach port 8000 with an arbitrary
    # mailbox_ids list can read any indexed mail. Unset now means the service
    # refuses to serve queries (see api/internal_auth.py) rather than serving
    # them to everyone.
    rag_internal_secret: str = ""

    # Internal HTTP URL of the Core Server, used to fetch attachment bytes for
    # vectorization (Postgres `attachments` table is metadata-only — see
    # ingestion/pg_attachment_source.py). Reuses rag_internal_secret as the
    # Bearer token — same shared secret, opposite direction of the query call.
    core_server_url: str = "http://127.0.0.1:3000"

    # Escape hatch for local dev / Swagger poking ONLY: allows /query/* to run
    # with no secret configured. Never enable anywhere the port is reachable
    # from another machine.
    rag_allow_insecure_internal: bool = False

    # ── Legacy compat (kept for scripts that still use uppercase names) ───────
    @property
    def QDRANT_HOST(self) -> str:
        return self.qdrant_host

    @property
    def QDRANT_PORT(self) -> int:
        return self.qdrant_port

    @property
    def COLLECTION_NAME(self) -> str:
        return self.collection_bodies

    @property
    def OLLAMA_BASE_URL(self) -> str:
        return self.ollama_base_url

    @property
    def OLLAMA_MODEL(self) -> str:
        return self.ollama_model

    @property
    def OLLAMA_TIMEOUT(self) -> int:
        return self.ollama_timeout

    @property
    def EMBED_MODEL_NAME(self) -> str:
        return self.embed_model_name

    @property
    def EMBED_BATCH_SIZE(self) -> int:
        return self.embed_batch_size

    @property
    def MAX_BODY_CHARS(self) -> int:
        return self.max_body_chars

    @property
    def MAX_CHUNK_CHARS(self) -> int:
        return self.chunk_size * 4  # approx char equivalent

    @property
    def VECTOR_SIZE(self) -> int:
        return self.vector_size

    @property
    def TOP_K_RESULTS(self) -> int:
        return self.top_k_results

    @property
    def SQLITE_DB_PATH(self) -> str:
        return "insight_hub.db"

    @property
    def QDRANT_PATH(self) -> str:
        return "./qdrant_data"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


# Module-level shorthand so existing imports still work
settings = get_settings()

# Legacy uppercase exports (for backward compat with any old code)
QDRANT_HOST = settings.qdrant_host
QDRANT_PORT = settings.qdrant_port
COLLECTION_NAME = settings.collection_bodies
OLLAMA_BASE_URL = settings.ollama_base_url
OLLAMA_MODEL = settings.ollama_model
OLLAMA_TIMEOUT = settings.ollama_timeout
EMBED_MODEL_NAME = settings.embed_model_name
EMBED_BATCH_SIZE = settings.embed_batch_size
MAX_BODY_CHARS = settings.max_body_chars
MAX_CHUNK_CHARS = settings.chunk_size * 4
VECTOR_SIZE = settings.vector_size
TOP_K_RESULTS = settings.top_k_results
SQLITE_DB_PATH = "insight_hub.db"
QDRANT_PATH = "./qdrant_data"