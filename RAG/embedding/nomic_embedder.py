# =============================================================================
# embedding/nomic_embedder.py — Ollama nomic-embed-text embedder
# =============================================================================
"""
NomicEmbedder wraps the Ollama /api/embed endpoint to produce 768-dim vectors
using the nomic-embed-text-v1.5 model.

Key design choices:
  - "search_document: " prefix for document chunks (ingestion)
  - "search_query: "    prefix for user queries (retrieval)
  - Automatic retry with exponential back-off (3 attempts)
  - Batch splitting to keep requests within Ollama's memory budget
"""
from __future__ import annotations

import logging
import threading
import time
from typing import List, Optional

import requests

from config import settings

logger = logging.getLogger(__name__)

_EMBED_URL = f"{settings.ollama_base_url}/api/embed"


def _retry(attempts: int = 3, delay: float = 2.0):
    """Simple retry decorator with exponential back-off."""
    def decorator(fn):
        def wrapper(*args, **kwargs):
            last_exc = None
            for attempt in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except Exception as exc:
                    last_exc = exc
                    if attempt < attempts:
                        wait = delay * (2 ** (attempt - 1))
                        logger.warning(
                            "%s failed (attempt %d/%d): %s — retrying in %.1fs",
                            fn.__name__, attempt, attempts, exc, wait,
                        )
                        time.sleep(wait)
            raise last_exc
        return wrapper
    return decorator


class NomicEmbedder:
    """
    Embed texts via Ollama nomic-embed-text API.

    Attributes:
        model:      Ollama model name (default: nomic-embed-text)
        dim:        Embedding dimension (768)
        base_url:   Ollama base URL
        timeout:    HTTP request timeout in seconds
    """

    DOCUMENT_PREFIX = "search_document: "
    QUERY_PREFIX    = "search_query: "

    def __init__(
        self,
        model:    Optional[str] = None,
        base_url: Optional[str] = None,
        timeout:  Optional[int] = None,
    ):
        self.model   = model    or settings.embed_model_name
        self.base_url = base_url or settings.ollama_base_url
        self.timeout  = timeout  or settings.ollama_timeout
        self.dim      = settings.vector_size
        self._url     = f"{self.base_url}/api/embed"
        self._ready   = False

    # ── Warm-up ───────────────────────────────────────────────────────────────

    def ensure_ready(self) -> None:
        """Pull model and run a warm-up ping (idempotent)."""
        if self._ready:
            return
        self._pull_model()
        try:
            self._call_api(["warm-up"])
            self._ready = True
            logger.info("✅ NomicEmbedder ready (model=%s)", self.model)
        except Exception as exc:
            logger.error("❌ NomicEmbedder warm-up failed: %s", exc)

    def _pull_model(self) -> None:
        try:
            res = requests.post(
                f"{self.base_url}/api/pull",
                json={"name": self.model, "stream": False},
                timeout=self.timeout,
            )
            res.raise_for_status()
            logger.info("✅ Pulled embedding model '%s'", self.model)
        except Exception as exc:
            logger.warning("Could not pull model '%s': %s", self.model, exc)

    # ── Public API ─────────────────────────────────────────────────────────────

    def embed_text(self, text: str) -> List[float]:
        """Embed a single document chunk (adds search_document prefix)."""
        return self.embed_batch([text])[0]

    def embed_query(self, query: str) -> List[float]:
        """Embed a user search query (adds search_query prefix)."""
        prefixed = self.QUERY_PREFIX + query.strip()
        return self._call_api([prefixed])[0]

    def embed_batch(
        self,
        texts: List[str],
        batch_size: Optional[int] = None,
    ) -> List[List[float]]:
        """
        Embed a list of document texts in batches.

        Args:
            texts:      List of raw text strings (prefix is added automatically).
            batch_size: Override default batch size from settings.

        Returns:
            List of 768-dim float vectors in the same order as input.
        """
        bs = batch_size or settings.embed_batch_size
        prefixed = [self.DOCUMENT_PREFIX + t.strip() for t in texts]
        all_vectors: List[List[float]] = []

        for i in range(0, len(prefixed), bs):
            batch = prefixed[i : i + bs]
            vecs  = self._call_api(batch)
            all_vectors.extend(vecs)

        return all_vectors

    # ── Health check ──────────────────────────────────────────────────────────

    def check_connection(self) -> bool:
        """Returns True if Ollama is reachable."""
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=5)
            return r.status_code == 200
        except Exception:
            return False

    # ── Internal ─────────────────────────────────────────────────────────────

    @_retry(attempts=3, delay=2.0)
    def _call_api(self, texts: List[str]) -> List[List[float]]:
        """POST to Ollama /api/embed and return embeddings list."""
        payload = {"model": self.model, "input": texts}
        response = requests.post(
            self._url,
            json=payload,
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json()
        embeddings = data.get("embeddings", [])
        if not embeddings:
            raise ValueError(f"Ollama returned empty embeddings for {len(texts)} texts")
        return embeddings


# ── Module-level singleton (used by pipeline and retrieval) ────────────────────
# NomicEmbedder itself is stateless per-call (no persistent session, just plain
# requests.post() per batch) so concurrent use from multiple threads is safe —
# the lock below only guards first-time construction/warm-up, since concurrent
# ingestion (IngestionPipeline's max_workers) can call get_embedder() from
# several worker threads simultaneously.
_embedder: Optional[NomicEmbedder] = None
_embedder_lock = threading.Lock()


def get_embedder() -> NomicEmbedder:
    """Return the shared NomicEmbedder singleton, initialising on first call."""
    global _embedder
    if _embedder is None:
        with _embedder_lock:
            if _embedder is None:
                _embedder = NomicEmbedder()
                _embedder.ensure_ready()
    return _embedder
