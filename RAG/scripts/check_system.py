#!/usr/bin/env python3
# =============================================================================
# scripts/check_system.py — Health check all services
# =============================================================================
"""
Usage:
    source /home/hackgodx/Projects/RP/venv/bin/activate
    python scripts/check_system.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import logging
import subprocess

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "


def check(label: str, ok: bool, detail: str = "") -> None:
    icon = PASS if ok else FAIL
    msg  = f"  {icon}  {label}"
    if detail:
        msg += f" — {detail}"
    logger.info(msg)


def main():
    from config import settings

    logger.info("\n" + "═" * 60)
    logger.info("  Insight Hub RAG — System Health Check")
    logger.info("═" * 60 + "\n")

    # ── Qdrant ─────────────────────────────────────────────────────────────
    logger.info("[ Qdrant ]")
    try:
        from vector_store.qdrant_client import EmailQdrantClient
        client = EmailQdrantClient()
        info   = client.get_collection_info()
        for col, stats in info.items():
            if "error" in stats:
                check(col, False, stats["error"])
            else:
                check(col, True, f"{stats.get('points_count', 0)} points")

        # Every real query from the Core Server filters on payload.mailbox_id
        # (build_mailbox_filter) — if existing points predate that field being
        # added, they're invisible to every such query despite the collection
        # having points. Sample one to catch this before it's a confusing
        # "chat says no emails found" symptom.
        sample = client.sample_payload(settings.collection_bodies)
        if sample is not None:
            has_mailbox_id = bool(sample.get("mailbox_id"))
            check(
                "sample point has payload.mailbox_id", has_mailbox_id,
                "" if has_mailbox_id else
                "MISSING — this point predates mailbox_id being added to the payload. "
                "Every query from the Core Server filters on it, so points like this "
                "are invisible and will look like \"no emails found\". Fix: "
                "python scripts/ingest_from_postgres.py --full-resync --clear",
            )
    except Exception as exc:
        check("Qdrant connection", False, str(exc))

    # ── Ollama / Embedding model ────────────────────────────────────────────
    logger.info("\n[ Ollama ]")
    try:
        import requests as _r
        r = _r.get(f"{settings.ollama_base_url}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        check("Ollama reachable", True, f"{len(models)} models")

        embed_ok = any(settings.embed_model_name in m for m in models)
        check(f"Embed model ({settings.embed_model_name})", embed_ok,
              "found" if embed_ok else "NOT FOUND — run: ollama pull nomic-embed-text")

        llm_ok = any(settings.ollama_model.split(":")[0] in m for m in models)
        check(f"LLM model ({settings.ollama_model})", llm_ok,
              "found" if llm_ok else f"NOT FOUND — run: ollama pull {settings.ollama_model}")
    except Exception as exc:
        check("Ollama", False, str(exc))

    # ── PostgreSQL ─────────────────────────────────────────────────────────
    logger.info("\n[ PostgreSQL ]")
    try:
        from db.session import check_db_connection
        ok = check_db_connection()
        check("PostgreSQL connection", ok,
              "connected" if ok else "FAILED — check POSTGRES_URL in .env")
    except Exception as exc:
        check("PostgreSQL", False, str(exc))

    # ── Redis ──────────────────────────────────────────────────────────────
    logger.info("\n[ Redis ]")
    try:
        import redis as _redis
        r = _redis.from_url(settings.redis_url, socket_timeout=3)
        r.ping()
        check("Redis", True, "pong")
    except Exception as exc:
        check("Redis", False, str(exc))

    # ── Tesseract OCR ──────────────────────────────────────────────────────
    logger.info("\n[ Tesseract OCR ]")
    try:
        result = subprocess.run(
            ["tesseract", "--version"],
            capture_output=True, text=True, timeout=5
        )
        version_line = result.stdout.split("\n")[0] if result.stdout else "unknown"
        check("tesseract", result.returncode == 0, version_line)
    except FileNotFoundError:
        check("tesseract", False, "NOT FOUND — install: sudo apt install tesseract-ocr")
    except Exception as exc:
        check("tesseract", False, str(exc))

    # ── Python packages ────────────────────────────────────────────────────
    logger.info("\n[ Python Packages ]")
    packages = [
        ("pdfplumber",           "pdfplumber"),
        ("pytesseract",          "pytesseract"),
        ("langchain_text_splitters", "langchain-text-splitters"),
        ("tiktoken",             "tiktoken"),
        ("sentence_transformers","sentence-transformers"),
        ("sqlalchemy",           "sqlalchemy"),
        ("fastapi",              "fastapi"),
        ("celery",               "celery"),
    ]
    for module, pip_name in packages:
        try:
            __import__(module)
            check(pip_name, True)
        except ImportError:
            check(pip_name, False, f"pip install {pip_name}")

    # ── Postgres messages (ingestion source) ──────────────────────────────
    logger.info("\n[ Data ]")
    try:
        from sqlalchemy import text
        from db.session import engine
        with engine.connect() as conn:
            count = conn.execute(text("SELECT count(*) FROM messages")).scalar_one()
        check("messages table", count > 0,
              f"{count} row(s)" if count else "NO MESSAGES FOUND — has the Collector synced any mailboxes yet?")
    except Exception as exc:
        check("messages table", False, str(exc))

    logger.info("\n" + "═" * 60 + "\n")


if __name__ == "__main__":
    main()
