# =============================================================================
# db/session.py — SQLAlchemy engine and session factory
# =============================================================================
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from config import settings

logger = logging.getLogger(__name__)

# ── Engine ─────────────────────────────────────────────────────────────────────
engine = create_engine(
    settings.postgres_url,
    pool_pre_ping=True,          # verify connection before use
    pool_size=5,
    max_overflow=10,
    echo=False,                  # set to True for SQL debug logging
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# ── FastAPI dependency ─────────────────────────────────────────────────────────
def get_db() -> Generator[Session, None, None]:
    """
    Yield a database session (for use as a FastAPI dependency).
    Ensures the session is closed after each request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── Context manager (for scripts) ─────────────────────────────────────────────
@contextmanager
def db_session() -> Generator[Session, None, None]:
    """Context manager for scripts and background tasks."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Create all tables (run on startup)."""
    from db.models import Base
    logger.info("Creating database tables…")
    Base.metadata.create_all(bind=engine)
    logger.info("✅ Database tables ready")


def check_db_connection() -> bool:
    """Return True if the PostgreSQL connection works."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.warning("DB connection check failed: %s", exc)
        return False
