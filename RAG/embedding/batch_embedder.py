# =============================================================================
# embedding/batch_embedder.py — Batch embedding with progress tracking
# =============================================================================
from __future__ import annotations

import gc
import logging
import time
from typing import List

from embedding.nomic_embedder import get_embedder
from ingestion.chunker import TextChunk

logger = logging.getLogger(__name__)


class BatchEmbedder:
    """
    Wraps NomicEmbedder to process lists of TextChunk objects.

    Attaches embeddings in-place and returns the same list for chaining.
    Processes one small batch at a time to avoid OOM on CPU systems.
    """

    def __init__(self):
        self._embedder = get_embedder()

    def embed_chunks(self, chunks: List[TextChunk]) -> List[TextChunk]:
        """
        Generate embeddings for a list of TextChunks (in-place).

        Each chunk receives an ``embedding`` attribute of type List[float].

        Returns:
            The same list with embeddings attached.
        """
        if not chunks:
            return chunks

        texts = [c.text for c in chunks]
        embeddings = self._embedder.embed_batch(texts)

        for chunk, vec in zip(chunks, embeddings):
            chunk.embedding = vec  # type: ignore[attr-defined]

        return chunks

    def embed_chunks_with_progress(
        self,
        chunks: List[TextChunk],
        label: str = "",
    ) -> List[TextChunk]:
        """Embed chunks and log progress (useful for large batches)."""
        total = len(chunks)
        logger.info("Embedding %d chunks %s…", total, f"({label})" if label else "")
        start = time.perf_counter()

        result = self.embed_chunks(chunks)

        elapsed = time.perf_counter() - start
        logger.info(
            "  ✅ Embedded %d chunks in %.1fs (%.1f chunks/s)",
            total, elapsed, total / elapsed if elapsed > 0 else 0,
        )
        gc.collect()
        return result
