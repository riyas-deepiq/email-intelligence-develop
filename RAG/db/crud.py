# =============================================================================
# db/crud.py — Database query functions
# =============================================================================
from __future__ import annotations

import logging
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from db.models import Department, IngestJob, SyncCursor, User

logger = logging.getLogger(__name__)


# ── User queries ──────────────────────────────────────────────────────────────

def get_user_by_id(db: Session, user_id: int) -> Optional[User]:
    return db.query(User).filter(User.id == user_id).first()


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    return db.query(User).filter(User.email == email.lower()).first()


def list_users(db: Session) -> List[User]:
    return db.query(User).join(User.department).order_by(User.id).all()


def get_department_by_name(db: Session, name: str) -> Optional[Department]:
    return db.query(Department).filter(Department.name == name).first()


# ── IngestJob CRUD ────────────────────────────────────────────────────────────

def create_ingest_job(db: Session) -> IngestJob:
    job = IngestJob(status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def update_ingest_job(
    db:       Session,
    job_id:   int,
    status:   Optional[str] = None,
    progress: Optional[str] = None,
    points:   Optional[int] = None,
    error:    Optional[str] = None,
) -> Optional[IngestJob]:
    job = db.query(IngestJob).filter(IngestJob.id == job_id).first()
    if not job:
        return None
    if status   is not None: job.status    = status
    if progress is not None: job.progress  = progress
    if points   is not None: job.points    = points
    if error    is not None: job.error_msg = error
    db.commit()
    db.refresh(job)
    return job


def get_ingest_job(db: Session, job_id: int) -> Optional[IngestJob]:
    return db.query(IngestJob).filter(IngestJob.id == job_id).first()


def list_ingest_jobs(db: Session, limit: int = 10) -> List[IngestJob]:
    """Most recent jobs first — what the dashboard shows as 'recent activity'."""
    return (
        db.query(IngestJob)
        .order_by(IngestJob.created_at.desc(), IngestJob.id.desc())
        .limit(limit)
        .all()
    )


def count_ingest_jobs_by_status(db: Session) -> dict:
    """
    {status: count} across every job ever recorded.

    Counted in the database rather than from the API process's in-memory
    `_jobs` dict, which holds only jobs started since the last restart.
    """
    from sqlalchemy import func as _func

    rows = (
        db.query(IngestJob.status, _func.count(IngestJob.id))
        .group_by(IngestJob.status)
        .all()
    )
    return {status: int(n) for status, n in rows}


# ── SyncCursor CRUD ───────────────────────────────────────────────────────────

def get_sync_cursor(db: Session, source: str) -> Optional[datetime]:
    """Return the last-synced timestamp for a source, or None if never synced."""
    row = db.query(SyncCursor).filter(SyncCursor.source == source).first()
    return row.last_synced_at if row else None


def set_sync_cursor(db: Session, source: str, ts: datetime) -> SyncCursor:
    """Advance (or create) the sync cursor for a source."""
    row = db.query(SyncCursor).filter(SyncCursor.source == source).first()
    if row is None:
        row = SyncCursor(source=source, last_synced_at=ts)
        db.add(row)
    else:
        row.last_synced_at = ts
    db.commit()
    db.refresh(row)
    return row
