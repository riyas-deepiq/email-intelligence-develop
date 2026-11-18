#!/usr/bin/env python3
# =============================================================================
# scripts/setup_qdrant.py — Idempotent Qdrant collection setup
# =============================================================================
"""
Usage:
    source /home/hackgodx/Projects/RP/venv/bin/activate
    python scripts/setup_qdrant.py
    python scripts/setup_qdrant.py --recreate   # drop and recreate
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import argparse
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
logger = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Set up Qdrant collections")
    parser.add_argument("--recreate", action="store_true", help="Drop and recreate collections")
    args = parser.parse_args()

    from vector_store.qdrant_client import EmailQdrantClient
    client = EmailQdrantClient()

    if args.recreate:
        logger.info("Recreating collections (--recreate flag set)…")
        client.recreate_collections()
    else:
        logger.info("Ensuring collections exist (idempotent)…")
        client.ensure_collections()

    info = client.get_collection_info()
    for name, stats in info.items():
        if "error" in stats:
            logger.error("  ❌ %s: %s", name, stats["error"])
        else:
            logger.info("  ✅ %s: %d points", name, stats.get("points_count", 0))


if __name__ == "__main__":
    main()
