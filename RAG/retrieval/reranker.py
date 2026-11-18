# =============================================================================
# retrieval/reranker.py — Cross-encoder reranker
# =============================================================================
"""
Reranker uses the cross-encoder/ms-marco-MiniLM-L-6-v2 model to rescore
(query, context) pairs and return the top-k most relevant chunks.

Falls back gracefully to score-based ordering if the model is unavailable
(e.g., no internet / model not downloaded yet).
"""
from __future__ import annotations

import logging
from typing import List, Optional

from config import settings
from retrieval.context_builder import EmailContext

logger = logging.getLogger(__name__)

# ── Singleton cross-encoder ───────────────────────────────────────────────────
_cross_encoder = None
_model_failed  = False


def _get_cross_encoder():
    global _cross_encoder, _model_failed
    if _model_failed:
        return None
    if _cross_encoder is not None:
        return _cross_encoder
    try:
        from sentence_transformers import CrossEncoder
        logger.info("Loading reranker model: %s", settings.reranker_model)
        _cross_encoder = CrossEncoder(settings.reranker_model)
        logger.info("✅ Reranker model loaded")
    except Exception as exc:
        logger.warning(
            "Cross-encoder unavailable (%s) — using score-based ranking", exc
        )
        _model_failed = True
        return None
    return _cross_encoder


class Reranker:
    """
    Rerank retrieved EmailContext objects using a cross-encoder model.

    The cross-encoder scores (query, subject + chunk_text) pairs directly,
    which is more accurate than cosine similarity alone.
    """

    def __init__(self):
        self._model = _get_cross_encoder()

    def rerank(
        self,
        query:    str,
        contexts: List[EmailContext],
        top_k:    int = 5,
    ) -> List[EmailContext]:
        """
        Re-rank contexts by relevance to query and return top_k.

        Args:
            query:    User's natural language question.
            contexts: Candidates from HybridSearch.
            top_k:    Number of results to return.

        Returns:
            Top-k EmailContext objects sorted by cross-encoder score (desc).
        """
        if not contexts:
            return []

        if len(contexts) <= top_k:
            return contexts

        model = _get_cross_encoder()

        if model is None:
            # Fallback: use cosine similarity scores already in context
            logger.debug("Reranker unavailable — using cosine scores")
            return sorted(contexts, key=lambda c: c.score, reverse=True)[:top_k]

        try:
            # Build (query, passage) pairs — include subject for context
            pairs = [
                (query, f"{ctx.subject}\n{ctx.chunk_text[:1000]}")
                for ctx in contexts
            ]
            scores = model.predict(pairs)

            # Attach cross-encoder score and sort
            ranked = sorted(
                zip(scores, contexts),
                key=lambda x: x[0],
                reverse=True,
            )
            result = [ctx for _, ctx in ranked[:top_k]]
            logger.debug(
                "Reranked %d → %d contexts (top score=%.4f)",
                len(contexts), len(result), ranked[0][0] if ranked else 0,
            )
            return result

        except Exception as exc:
            logger.warning("Reranker prediction failed: %s — falling back", exc)
            return sorted(contexts, key=lambda c: c.score, reverse=True)[:top_k]
