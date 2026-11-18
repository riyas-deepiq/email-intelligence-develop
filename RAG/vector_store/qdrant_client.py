# =============================================================================
# vector_store/qdrant_client.py — EmailQdrantClient
# =============================================================================
"""
EmailQdrantClient wraps the raw QdrantClient to provide typed methods for
upserting and searching email/attachment chunks.

Two collections are managed:
  email_bodies        — body text chunks
  email_attachments   — attachment chunks
"""
from __future__ import annotations

import logging
import threading
import uuid
from typing import Dict, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchAny,
    MatchText,
    MatchValue,
    PointStruct,
    QueryResponse,
    ScoredPoint,
    VectorParams,
)

from config import settings
from ingestion.chunker import TextChunk

logger = logging.getLogger(__name__)

# ── Singleton client ──────────────────────────────────────────────────────────
# QdrantClient itself is safe for concurrent use from multiple threads (it
# wraps httpx/grpc, both thread-safe) — the lock below only guards first-time
# construction, since concurrent ingestion (IngestionPipeline's max_workers)
# can call get_qdrant_client() from several worker threads simultaneously.
_client: Optional[QdrantClient] = None
_client_lock = threading.Lock()


def get_qdrant_client() -> QdrantClient:
    """Return the shared QdrantClient singleton."""
    global _client
    if _client is None:
        with _client_lock:
            if _client is None:
                logger.info(
                    "Connecting to Qdrant at %s:%d", settings.qdrant_host, settings.qdrant_port
                )
                _client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
                logger.info("✅ Qdrant client ready")
    return _client


# ── EmailQdrantClient ─────────────────────────────────────────────────────────

class EmailQdrantClient:
    """High-level Qdrant operations for the email RAG system."""

    def __init__(self, client: Optional[QdrantClient] = None):
        self._client = client or get_qdrant_client()

    # ── Collection management ──────────────────────────────────────────────────

    def recreate_collections(self) -> None:
        """Drop and recreate both collections."""
        from vector_store.collections import setup_collections
        setup_collections(self._client, recreate=True)

    def ensure_collections(self) -> None:
        """Create collections if they don't exist (idempotent)."""
        from vector_store.collections import setup_collections
        setup_collections(self._client, recreate=False)

    def get_collection_info(self, collection: Optional[str] = None) -> dict:
        """Return point count and status for one or both collections."""
        results = {}
        for name in [settings.collection_bodies, settings.collection_attachments]:
            try:
                info = self._client.get_collection(name)
                results[name] = {
                    "status":       str(info.status),
                    "points_count": info.points_count,
                    "vectors_count": getattr(info, "vectors_count", info.points_count),
                }
            except Exception as exc:
                results[name] = {"error": str(exc)}
        return results

    def sample_payload(self, collection: str) -> Optional[dict]:
        """Return one point's payload from a collection, or None if it's empty
        (or unreachable). Used by check_system.py to catch points that predate
        a payload field being added — e.g. mailbox_id — before that shows up
        as a confusing "no emails found" symptom downstream."""
        try:
            points, _ = self._client.scroll(collection_name=collection, limit=1, with_payload=True)
            return points[0].payload if points else None
        except Exception:
            return None

    # ── Upsert ────────────────────────────────────────────────────────────────

    def upsert_email_chunks(self, chunks: List[TextChunk]) -> int:
        """Upsert body chunks into email_bodies collection."""
        return self._upsert_chunks(chunks, settings.collection_bodies)

    def upsert_attachment_chunks(self, chunks: List[TextChunk]) -> int:
        """Upsert attachment chunks into email_attachments collection."""
        return self._upsert_chunks(chunks, settings.collection_attachments)

    def _upsert_chunks(self, chunks: List[TextChunk], collection: str) -> int:
        """Internal: convert TextChunks to PointStructs and upsert."""
        points: List[PointStruct] = []

        for chunk in chunks:
            embedding = getattr(chunk, "embedding", None)
            if embedding is None:
                logger.warning("Chunk missing embedding — skipping")
                continue

            payload = {
                "email_id":     chunk.email_id,
                "chunk_index":  chunk.chunk_index,
                "chunk_text":   chunk.text,
                "subject":      chunk.subject,
                "from_addr":    chunk.from_addr,
                "to":           chunk.to_addrs,
                "cc":           chunk.cc_addrs,
                "date":         chunk.date,
                "thread_id":    chunk.thread_id,
                "source_type":  chunk.source_type,
                "token_count":  chunk.token_count,
                "department":   chunk.department,
                "rbac_sender":  chunk.rbac_sender,
                "rbac_to":      chunk.rbac_to,
                "rbac_cc":      chunk.rbac_cc,
                # Real access-control scope (Postgres source only) — see
                # build_mailbox_filter(): this is what the Core Server actually
                # filters on, since getScopedMailboxIds() is its established
                # RBAC primitive, not the department/role scheme below.
                "mailbox_id":   chunk.mailbox_id,
                "org_id":       chunk.org_id,
            }

            # Attachment-specific
            if chunk.source_type == "attachment":
                payload["filename"] = chunk.filename
                if chunk.page_num is not None:
                    payload["page_num"] = chunk.page_num
                if chunk.attachment_id:
                    payload["attachment_id"] = chunk.attachment_id

            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=embedding,
                    payload=payload,
                )
            )

        if not points:
            return 0

        self._client.upsert(collection_name=collection, points=points)
        logger.debug("Upserted %d points into %s", len(points), collection)
        return len(points)

    # ── Search ─────────────────────────────────────────────────────────────────

    def search(
        self,
        query_vector: List[float],
        collection: str,
        top_k: int = 20,
        qdrant_filter: Optional[Filter] = None,
        score_threshold: float = 0.0,
    ) -> List[ScoredPoint]:
        """
        Dense vector search against a collection.

        Args:
            query_vector:    768-dim query embedding.
            collection:      Collection name.
            top_k:           Max results to return.
            qdrant_filter:   Optional pre-built Qdrant Filter.
            score_threshold: Minimum cosine similarity score.

        Returns:
            List of ScoredPoint objects.
        """
        response: QueryResponse = self._client.query_points(
            collection_name=collection,
            query=query_vector,
            query_filter=qdrant_filter,
            limit=top_k,
            with_payload=True,
            score_threshold=score_threshold if score_threshold > 0 else None,
        )
        return response.points

    # ── Filter builder ────────────────────────────────────────────────────────

    @staticmethod
    def build_rbac_filter(
        role: str,
        department_name: str,
        user_email: str,
    ) -> Optional[Filter]:
        """
        Build a Qdrant Filter based on RBAC role.

        Roles:
          executive       → None (no filter, sees everything)
          department_head → dept OR personal
          employee        → personal only
        """
        if role == "executive":
            return None

        personal = [
            FieldCondition(key="rbac_sender", match=MatchValue(value=user_email)),
            FieldCondition(key="rbac_to",     match=MatchValue(value=user_email)),
            FieldCondition(key="rbac_cc",     match=MatchValue(value=user_email)),
        ]

        if role == "department_head":
            dept_cond = FieldCondition(
                key="department",
                match=MatchValue(value=department_name),
            )
            return Filter(should=personal + [dept_cond])

        return Filter(should=personal)

    @staticmethod
    def build_mailbox_filter(mailbox_ids: List[str]) -> Filter:
        """
        Build a Qdrant Filter restricting results to a specific set of mailbox
        IDs — the real access-control primitive the Core Server already uses
        (getScopedMailboxIds: a user's own mailbox + their org-hierarchy
        reports' mailboxes, or every mailbox for admins). Used by the
        server-to-server integration instead of build_rbac_filter()'s
        department/role scheme, since the caller has already resolved the
        caller's real, authenticated scope and just needs Qdrant to honor it.

        An empty list is intentionally NOT "no filter" — it must return zero
        results (a user allowed to see nothing should see nothing), so the
        caller doesn't have to special-case that before calling in.
        """
        if not mailbox_ids:
            return Filter(must=[FieldCondition(key="mailbox_id", match=MatchValue(value="__none__"))])
        return Filter(must=[FieldCondition(key="mailbox_id", match=MatchAny(any=mailbox_ids))])

    # ── Delete ─────────────────────────────────────────────────────────────────

    def delete_email(self, email_id: str, collections: Optional[List[str]] = None) -> None:
        """
        Remove all chunks for an email_id.

        Defaults to both collections — correct for a real "delete this email"
        (e.g. DELETE /emails/{id}: its attachments should go too). Body
        The body pass uses collections=[bodies] because attachment chunks are
        repopulated by the attachment pass later in the combined Postgres
        workflow. Deleting both here would temporarily erase file vectors and
        would lose them if a provider download failed during that later pass.
        """
        from qdrant_client.models import FilterSelector
        email_filter = Filter(
            must=[FieldCondition(key="email_id", match=MatchValue(value=email_id))]
        )
        target_collections = collections or [settings.collection_bodies, settings.collection_attachments]
        for col in target_collections:
            try:
                self._client.delete(
                    collection_name=col,
                    points_selector=FilterSelector(filter=email_filter),
                )
                logger.info("Deleted email_id=%s from %s", email_id, col)
            except Exception as exc:
                logger.warning("Delete failed for %s in %s: %s", email_id, col, exc)

    def delete_attachment(self, attachment_id: str) -> None:
        """Remove all chunks for one Postgres `attachments.id` from
        email_attachments — lets re-running attachment ingestion stay
        idempotent, same role delete_email() plays before a body re-upsert."""
        from qdrant_client.models import FilterSelector
        att_filter = Filter(
            must=[FieldCondition(key="attachment_id", match=MatchValue(value=attachment_id))]
        )
        try:
            self._client.delete(
                collection_name=settings.collection_attachments,
                points_selector=FilterSelector(filter=att_filter),
            )
        except Exception as exc:
            logger.warning("Delete failed for attachment_id=%s: %s", attachment_id, exc)
