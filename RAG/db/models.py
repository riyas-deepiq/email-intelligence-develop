# =============================================================================
# db/models.py — SQLAlchemy ORM models (PostgreSQL)
# =============================================================================
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Department(Base):
    # Prefixed rag_ — RAG connects to the same Postgres database as the Core
    # Server (see config.postgres_url / server's DATABASE_URL), which already
    # owns an unrelated `users` table (Drizzle-managed). Unprefixed names here
    # would collide with it under create_all().
    __tablename__ = "rag_departments"

    id:   Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    users: Mapped[list["User"]] = relationship("User", back_populates="department")

    def __repr__(self) -> str:
        return f"Department(id={self.id}, name={self.name!r})"


class User(Base):
    # See Department's rag_ note above — distinct from the Core Server's `users`
    # table (different schema/purpose: this one only maps an email to an RBAC
    # department for the RAG dept-scoped filter).
    __tablename__ = "rag_users"

    id:            Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name:          Mapped[str] = mapped_column(String(200), nullable=False)
    email:         Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    role:          Mapped[str] = mapped_column(
        String(50), nullable=False
    )  # executive | department_head | employee
    department_id: Mapped[int] = mapped_column(Integer, ForeignKey("rag_departments.id"), nullable=False)

    department: Mapped["Department"] = relationship("Department", back_populates="users")

    def __repr__(self) -> str:
        return f"User(id={self.id}, email={self.email!r}, role={self.role!r})"

    @property
    def department_name(self) -> str:
        return self.department.name if self.department else ""


class IngestJob(Base):
    """Tracks the status of ingestion jobs (for async progress polling)."""
    __tablename__ = "rag_ingest_jobs"

    id:         Mapped[int]      = mapped_column(Integer, primary_key=True, autoincrement=True)
    status:     Mapped[str]      = mapped_column(String(50), default="pending")   # pending|running|done|error
    progress:   Mapped[str]      = mapped_column(Text, default="")
    points:     Mapped[int]      = mapped_column(Integer, default=0)
    error_msg:  Mapped[str]      = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    def __repr__(self) -> str:
        return f"IngestJob(id={self.id}, status={self.status!r})"


class SyncCursor(Base):
    """
    Tracks incremental ingestion progress per source (message bodies and
    attachment metadata use independent rows), so the combined workflow only
    picks up new/changed content instead of re-embedding everything each time.
    """
    __tablename__ = "rag_sync_cursor"

    id:             Mapped[int]                = mapped_column(Integer, primary_key=True, autoincrement=True)
    source:         Mapped[str]                 = mapped_column(String(50), nullable=False, unique=True)
    last_synced_at: Mapped[Optional[datetime]]  = mapped_column(DateTime(timezone=True), nullable=True)

    def __repr__(self) -> str:
        return f"SyncCursor(source={self.source!r}, last_synced_at={self.last_synced_at!r})"
