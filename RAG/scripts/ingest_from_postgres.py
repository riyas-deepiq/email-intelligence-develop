#!/usr/bin/env python3
# =============================================================================
# scripts/ingest_from_postgres.py — Bulk ingest mail and attachments
# =============================================================================
"""
Usage:
    source /home/hackgodx/Projects/RP/venv/bin/activate
    python scripts/ingest_from_postgres.py
    python scripts/ingest_from_postgres.py --mailbox-id <uuid> --full-resync
    python scripts/ingest_from_postgres.py --since 2026-01-01T00:00:00+00:00 --clear
    python scripts/ingest_from_postgres.py --workers 8
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
        description="Ingest mail and attachment content from Postgres into Qdrant"
    )
    parser.add_argument("--mailbox-id",  default=None, help="Restrict to a single mailbox UUID")
    parser.add_argument("--org-id",      default=None, help="Restrict to a single organization UUID")
    parser.add_argument("--since",       default=None, help="ISO-8601 timestamp; overrides the stored sync cursor")
    parser.add_argument("--full-resync", action="store_true", help="Ignore the stored cursor and re-ingest all messages")
    parser.add_argument("--clear",       action="store_true", help="Recreate Qdrant collections before ingesting")
    parser.add_argument("--workers",     type=int, default=None, metavar="N",
                         help="Emails to process concurrently (default: INGEST_MAX_WORKERS from .env)")
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
    logger.info("  Insight Hub RAG — Postgres Ingestion Script")
    logger.info("=" * 60)

    pipeline = IngestionPipeline(clear_collections=args.clear)
    mail_total = pipeline.ingest_from_postgres(
        since=since_dt,
        mailbox_id=args.mailbox_id,
        org_id=args.org_id,
        use_cursor=not args.full_resync,
        max_workers=workers,
        finish_progress=False,
    )
    attachment_total = pipeline.ingest_attachments_from_postgres(
        since=since_dt,
        mailbox_id=args.mailbox_id,
        org_id=args.org_id,
        use_cursor=not args.full_resync,
        max_workers=workers,
    )
    total = mail_total + attachment_total

    logger.info("=" * 60)
    logger.info(
        "  ✅ Done. %d mail + %d attachment chunks (%d total) upserted to Qdrant.",
        mail_total, attachment_total, total,
    )
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
