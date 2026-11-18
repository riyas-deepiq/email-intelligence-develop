# =============================================================================
# vector_store/collections.py — Qdrant collection setup and schema
# =============================================================================
"""
Creates two Qdrant collections with HNSW optimisation and payload indexes:

  email_bodies        → body text chunks
  email_attachments   → attachment text chunks

Both use 768-dim COSINE vectors (nomic-embed-text-v1.5).
"""
from __future__ import annotations

import logging
from typing import Optional

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    HnswConfigDiff,
    PayloadSchemaType,
    VectorParams,
)

from config import settings

logger = logging.getLogger(__name__)


def _create_collection(
    client: QdrantClient,
    name: str,
    recreate: bool = False,
) -> None:
    """Create a single collection, optionally deleting the existing one first."""
    if recreate:
        try:
            client.delete_collection(name)
            logger.info("Deleted collection: %s", name)
        except Exception:
            pass  # collection didn't exist

    # Check if already exists (idempotent)
    try:
        client.get_collection(name)
        if not recreate:
            logger.info("Collection already exists: %s", name)
            return
    except Exception:
        pass  # does not exist — proceed to create

    client.create_collection(
        collection_name=name,
        vectors_config=VectorParams(
            size=settings.vector_size,
            distance=Distance.COSINE,
        ),
        hnsw_config=HnswConfigDiff(
            m=16,
            ef_construct=200,
        ),
    )
    logger.info("✅ Created collection: %s", name)


def _create_payload_indexes(client: QdrantClient, collection_name: str, is_attachment: bool = False) -> None:
    """Create payload indexes for efficient filtering."""
    indexes = [
        ("email_id",   PayloadSchemaType.KEYWORD),
        ("from_addr",  PayloadSchemaType.KEYWORD),
        ("thread_id",  PayloadSchemaType.KEYWORD),
        ("department", PayloadSchemaType.KEYWORD),
        ("date",       PayloadSchemaType.KEYWORD),
        # mailbox_id is the primary filter on every real query from the Core
        # Server (build_mailbox_filter) — without an index this still returns
        # correct results (Qdrant can filter unindexed fields), just via a
        # full scan instead of an index lookup, getting slower as the
        # collection grows. org_id indexed too since it's the natural
        # multi-tenant scoping field alongside it.
        ("mailbox_id", PayloadSchemaType.KEYWORD),
        ("org_id",     PayloadSchemaType.KEYWORD),
    ]
    if is_attachment:
        indexes.append(("filename", PayloadSchemaType.KEYWORD))
        # Lets delete_attachment() target one Postgres `attachments.id` for
        # idempotent re-ingestion without a full-collection scan.
        indexes.append(("attachment_id", PayloadSchemaType.KEYWORD))

    for field_name, schema_type in indexes:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=schema_type,
            )
        except Exception as exc:
            logger.debug("Index %s.%s: %s", collection_name, field_name, exc)


def setup_collections(
    client: QdrantClient,
    recreate: bool = False,
) -> None:
    """
    Create both collections with indexes.  Idempotent when recreate=False.

    Args:
        client:   Connected QdrantClient.
        recreate: If True, drop and recreate both collections.
    """
    logger.info("Setting up Qdrant collections (recreate=%s)…", recreate)

    # email_bodies
    _create_collection(client, settings.collection_bodies, recreate=recreate)
    _create_payload_indexes(client, settings.collection_bodies, is_attachment=False)

    # email_attachments
    _create_collection(client, settings.collection_attachments, recreate=recreate)
    _create_payload_indexes(client, settings.collection_attachments, is_attachment=True)

    logger.info("✅ Collections ready: %s, %s",
                settings.collection_bodies, settings.collection_attachments)
