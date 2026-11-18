#!/usr/bin/env python3
# =============================================================================
# scripts/ingest_attachments.py — Deprecated attachment-only repair command
# =============================================================================
"""
Usage:
    source /home/hackgodx/Projects/RP/venv/bin/activate
    python scripts/ingest_attachments.py
    python scripts/ingest_attachments.py --mailbox-id <uuid> --full-resync
    python scripts/ingest_attachments.py --since 2026-01-01T00:00:00+00:00
    python scripts/ingest_attachments.py --workers 8

Reads the Postgres `attachments` table (metadata only), fetches each
attachment's bytes live via the Core Server's internal RAG channel, extracts
text, and upserts chunks into the email_attachments Qdrant collection. See
ingestion/pipeline.py's ingest_attachments_from_postgres() for the full
incremental-cursor / concurrency design (mirrors ingest_from_postgres.py).

Deprecated for normal operation: mailbox sync and ingest_from_postgres.py now
process mail and attachments together. Keep this only for attachment-only
repair/reindex work.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(
        description="Vectorize attachment content from the Postgres `attachments` table into Qdrant"
    )
    parser.add_argument("--mailbox-id",  default=None, help="Restrict to a single mailbox UUID")
    parser.add_argument("--org-id",      default=None, help="Restrict to a single organization UUID")
    parser.add_argument("--since",       default=None, help="ISO-8601 timestamp; overrides the stored sync cursor")
    parser.add_argument("--full-resync", action="store_true", help="Ignore the stored cursor and re-ingest all attachments")
    parser.add_argument("--workers",     type=int, default=None, metavar="N",
                         help="Attachments to process concurrently (default: INGEST_MAX_WORKERS from .env)")
    args = parser.parse_args()

    # Ensure rag_sync_cursor (and the other RAG-local tables) exist even if the
    # FastAPI app has never been started against this database.
    from db.session import init_db
    init_db()

    from config import settings
    from ingestion.pipeline import IngestionPipeline

    since_dt = datetime.fromisoformat(args.since) if args.since else None
    workers = args.workers if args.workers is not None else settings.ingest_max_workers

    logger.info("=" * 60)
    logger.warning("  DEPRECATED — attachment-only repair mode")
    logger.info("=" * 60)

    pipeline = IngestionPipeline()
    total = pipeline.ingest_attachments_from_postgres(
        since=since_dt,
        mailbox_id=args.mailbox_id,
        org_id=args.org_id,
        use_cursor=not args.full_resync,
        max_workers=workers,
    )

    logger.info("=" * 60)
    logger.info("  ✅ Done. %d total chunks upserted to Qdrant.", total)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
