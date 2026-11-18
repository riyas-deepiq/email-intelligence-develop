# =============================================================================
# api/routes/emails.py — Email browse/management endpoints
# =============================================================================
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.models import EmailListResponse, EmailSummary
from config import settings
from db.session import get_db
from vector_store.qdrant_client import EmailQdrantClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/emails", tags=["emails"])

_qdrant: Optional[EmailQdrantClient] = None


def _get_qdrant() -> EmailQdrantClient:
    global _qdrant
    if _qdrant is None:
        _qdrant = EmailQdrantClient()
    return _qdrant


@router.get("/list", response_model=EmailListResponse, summary="List indexed emails")
async def list_emails(
    page:  int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Return paginated list of unique emails stored in email_bodies collection.
    Scans the collection and deduplicates by email_id.
    """
    from qdrant_client.models import ScrollRequest

    client = _get_qdrant()._client
    offset = None
    seen:   dict[str, EmailSummary] = {}
    target = page * limit

    while len(seen) < target:
        result, next_offset = client.scroll(
            collection_name=settings.collection_bodies,
            limit=100,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        if not result:
            break

        for point in result:
            p = point.payload or {}
            eid = p.get("email_id", "")
            if eid and eid not in seen:
                seen[eid] = EmailSummary(
                    email_id=eid,
                    subject=p.get("subject", ""),
                    from_addr=p.get("from_addr", p.get("sender", "")),
                    date=p.get("date", ""),
                    chunk_count=1,
                )
            elif eid in seen:
                seen[eid].chunk_count += 1

        offset = next_offset
        if offset is None:
            break

    all_emails = list(seen.values())
    total      = len(all_emails)
    start      = (page - 1) * limit
    page_items = all_emails[start : start + limit]

    return EmailListResponse(
        emails=page_items,
        total=total,
        page=page,
        limit=limit,
    )


@router.get("/thread/{thread_id}", summary="Get email thread chunks")
async def get_thread(thread_id: str):
    """Return all chunks belonging to a thread."""
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    client = _get_qdrant()._client
    thread_filter = Filter(
        must=[FieldCondition(key="thread_id", match=MatchValue(value=thread_id))]
    )
    result, _ = client.scroll(
        collection_name=settings.collection_bodies,
        scroll_filter=thread_filter,
        limit=50,
        with_payload=True,
        with_vectors=False,
    )
    return {
        "thread_id": thread_id,
        "chunks": [
            {
                "email_id":   p.payload.get("email_id", ""),
                "subject":    p.payload.get("subject", ""),
                "from_addr":  p.payload.get("from_addr", ""),
                "date":       p.payload.get("date", ""),
                "chunk_text": p.payload.get("chunk_text", "")[:300],
            }
            for p in result
        ],
    }


@router.delete("/{email_id}", summary="Remove email from index")
async def delete_email(email_id: str):
    """Delete all chunks for an email_id from both collections."""
    _get_qdrant().delete_email(email_id)
    return {"deleted": email_id}
