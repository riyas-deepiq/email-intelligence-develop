# =============================================================================
# retrieval/hybrid_search.py — Dense search over email_bodies + email_attachments
# =============================================================================
"""
HybridSearch performs dense vector search over both Qdrant collections,
merges results by score, and returns a unified list of EmailContext objects.

"Hybrid" here refers to the union of two collections (bodies + attachments),
not sparse+dense fusion — that can be added in a future iteration.
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

from qdrant_client.models import Filter

from config import settings
from embedding.nomic_embedder import get_embedder
from retrieval.context_builder import EmailContext
from vector_store.qdrant_client import EmailQdrantClient

logger = logging.getLogger(__name__)


class HybridSearch:
    """
    Retrieve relevant email chunks using dense vector similarity.

    Searches both email_bodies and email_attachments collections,
    then merges and ranks by cosine score.
    """

    def __init__(self, qdrant: Optional[EmailQdrantClient] = None):
        self._qdrant   = qdrant or EmailQdrantClient()
        self._embedder = get_embedder()

    def search(
        self,
        query:              str,
        top_k:              int = 20,
        qdrant_filter:      Optional[Filter] = None,
        search_attachments: bool = True,
        score_threshold:    float = 0.0,
    ) -> List[EmailContext]:
        """
        Execute hybrid search.

        Args:
            query:              User's natural language question.
            top_k:              Max total results to return (before reranking).
            qdrant_filter:      Pre-built RBAC filter (None = no restriction).
            search_attachments: Whether to also search attachment collection.
            score_threshold:    Minimum score to include a result.

        Returns:
            List of EmailContext objects sorted by descending score.
        """
        query_vector = self._embedder.embed_query(query)

        # ── Search email_bodies ────────────────────────────────────────────────
        body_points = self._qdrant.search(
            query_vector=query_vector,
            collection=settings.collection_bodies,
            top_k=top_k,
            qdrant_filter=qdrant_filter,
            score_threshold=score_threshold,
        )
        logger.debug("Bodies search: %d results", len(body_points))

        # ── Search email_attachments ───────────────────────────────────────────
        att_points = []
        if search_attachments:
            att_k = max(top_k // 2, 10)
            att_points = self._qdrant.search(
                query_vector=query_vector,
                collection=settings.collection_attachments,
                top_k=att_k,
                qdrant_filter=qdrant_filter,
                score_threshold=score_threshold,
            )
            logger.debug("Attachments search: %d results", len(att_points))

        # ── Merge and sort by score ────────────────────────────────────────────
        all_points = body_points + att_points
        all_points.sort(key=lambda p: p.score, reverse=True)

        contexts = [EmailContext.from_scored_point(p) for p in all_points[:top_k]]
        logger.info(
            "HybridSearch returned %d contexts (bodies=%d, attachments=%d, filter=%s, score_threshold=%s)",
            len(contexts), len(body_points), len(att_points),
            "none" if qdrant_filter is None else "applied", score_threshold,
        )

        # Empty result is ambiguous on its own — could be the filter excluding
        # everything (e.g. points missing a field it filters on) or the score
        # threshold cutting off genuine-but-low-scoring matches. Disambiguate
        # once, cheaply, so this is visible in logs instead of a silent "0
        # contexts" that looks identical either way.
        if not contexts:
            self._log_empty_result_diagnosis(query_vector, qdrant_filter, score_threshold)

        return contexts

    def _log_empty_result_diagnosis(
        self,
        query_vector: List[float],
        qdrant_filter: Optional[Filter],
        score_threshold: float,
    ) -> None:
        """Re-runs the same search against email_bodies with the filter but no
        score threshold, and separately with neither, to tell apart "filter
        matched nothing" from "matched, but scored below threshold" from
        "nothing in the collection is even close" (embedding/model mismatch)."""
        try:
            unthresholded = self._qdrant.search(
                query_vector=query_vector, collection=settings.collection_bodies,
                top_k=1, qdrant_filter=qdrant_filter, score_threshold=0.0,
            )
            if qdrant_filter is not None and not unthresholded:
                logger.warning(
                    "Empty result diagnosis: the filter matched ZERO points even with "
                    "no score threshold — check that ingested points actually have the "
                    "payload field(s) this filter checks (e.g. re-ingest with "
                    "--full-resync --clear if points predate a payload field being added)."
                )
                return

            unfiltered = self._qdrant.search(
                query_vector=query_vector, collection=settings.collection_bodies,
                top_k=1, qdrant_filter=None, score_threshold=0.0,
            )
            top_score = unthresholded[0].score if unthresholded else (unfiltered[0].score if unfiltered else None)
            if top_score is not None and top_score < score_threshold:
                logger.warning(
                    "Empty result diagnosis: top match scored %.4f, below score_threshold=%s "
                    "— either lower SCORE_THRESHOLD in .env, or this query genuinely has no "
                    "close match yet.", top_score, score_threshold,
                )
            elif not unfiltered:
                logger.warning(
                    "Empty result diagnosis: no points scored above 0 at all for this query "
                    "vector against email_bodies — check the embedding model used at query "
                    "time matches what was used at ingestion time (EMBED_MODEL_NAME)."
                )
        except Exception as exc:
            logger.debug("Empty result diagnosis skipped: %s", exc)

    def search_with_rbac(
        self,
        query:              str,
        role:               str,
        department_name:    str,
        user_email:         str,
        top_k:              int = 20,
        search_attachments: bool = True,
    ) -> List[EmailContext]:
        """Convenience wrapper that builds the RBAC filter automatically."""
        rbac_filter = EmailQdrantClient.build_rbac_filter(
            role=role,
            department_name=department_name,
            user_email=user_email,
        )
        return self.search(
            query=query,
            top_k=top_k,
            qdrant_filter=rbac_filter,
            search_attachments=search_attachments,
            score_threshold=settings.score_threshold,
        )
