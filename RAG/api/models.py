# =============================================================================
# api/models.py — Pydantic v2 request/response schemas
# =============================================================================
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Query ─────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    query:              str   = Field(..., min_length=1, description="User question")
    user_id:            int   = Field(1, description="Echoed back in the response; NOT used for access scoping")
    mailbox_ids:        List[str] = Field(
        ...,
        description=(
            "REQUIRED. Trusted, pre-resolved mailbox scope from the Core Server "
            "(getScopedMailboxIds()/admin-check). This is the only thing that "
            "scopes results — an empty list means 'see nothing', not 'no filter'. "
            "Previously optional, which allowed callers to omit it and have RAG "
            "resolve scope from a self-declared user_id, bypassing the org "
            "hierarchy entirely."
        ),
    )
    top_k:              int   = Field(20, ge=1, le=100)
    rerank_k:           int   = Field(5,  ge=1, le=20)
    temperature:        float = Field(0.1, ge=0.0, le=2.0)
    search_attachments: bool  = Field(True)
    stream:             bool  = Field(False)


class SourceChunk(BaseModel):
    email_id:    str
    thread_id:   str = ""
    subject:     str
    from_addr:   str
    date:        str
    source_type: str          # "body" | "attachment"
    filename:    str = ""
    score:       float
    excerpt:     str          # first 400 chars of chunk_text


class QueryResponse(BaseModel):
    answer:     str
    chunks:     List[SourceChunk]
    user_id:    int
    query:      str
    elapsed_ms: int


# ── Ingest ────────────────────────────────────────────────────────────────────

class IngestPostgresRequest(BaseModel):
    mailbox_id:  Optional[str] = Field(None, description="Restrict to a single mailbox UUID")
    org_id:      Optional[str] = Field(None, description="Restrict to a single organization UUID")
    since:       Optional[str] = Field(None, description="ISO-8601 timestamp; overrides the stored sync cursor")
    full_resync: bool          = Field(False, description="Ignore the stored cursor and re-scan from the beginning")
    clear:       bool          = Field(False, description="Recreate Qdrant collections before ingesting")
    max_workers: Optional[int] = Field(None, ge=1, le=32, description="Emails to process concurrently (default: INGEST_MAX_WORKERS)")


class IngestAttachmentsRequest(BaseModel):
    mailbox_id:  Optional[str] = Field(None, description="Restrict to a single mailbox UUID")
    org_id:      Optional[str] = Field(None, description="Restrict to a single organization UUID")
    since:       Optional[str] = Field(None, description="ISO-8601 timestamp; overrides the stored sync cursor")
    full_resync: bool          = Field(False, description="Ignore the stored cursor and re-scan from the beginning")
    max_workers: Optional[int] = Field(None, ge=1, le=32, description="Attachments to process concurrently (default: INGEST_MAX_WORKERS)")


class StageProgress(BaseModel):
    """
    One stage of a run, as reported by ingestion/progress.py's StageTracker.

    Stages run once per email in a loop rather than once each, so `elapsed_ms`
    is the wall-clock span from the stage's first run to its completion — the
    five values overlap and do NOT sum to the run total.
    """
    key:        str            # read | extract | chunk | embed | store
    label:      str            # operator-facing name
    unit:       str            # what `count` counts — emails, files, passages…
    state:      str            # pending | running | done
    count:      int
    started_at: Optional[float] = None   # unix seconds
    ended_at:   Optional[float] = None   # unix seconds
    elapsed_ms: Optional[int]   = None


class LogLine(BaseModel):
    """One timestamped line from a run's in-memory log."""
    ts:      float             # unix seconds
    level:   str               # info | warn | error
    message: str


class IngestStatusResponse(BaseModel):
    job_id:    int
    status:    str             # pending | running | done | error
    progress:  str
    points:    int
    error_msg: str
    # Empty for jobs started before this process booted — live stage state is
    # held in memory only, so a restart loses it while the DB row survives.
    stages:    List[StageProgress] = []


class IngestJobSummary(BaseModel):
    """One row of the dashboard's 'recent indexing runs' list."""
    job_id:     int
    status:     str            # pending | running | done | error
    progress:   str
    points:     int
    error_msg:  str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class IndexOverviewResponse(BaseModel):
    """
    Everything the Core Server's dashboard needs about the search index, in one
    call. Deliberately returns raw facts — chunks, collections, model names —
    and leaves the customer-friendly wording to the web interface, so this stays
    usable for debugging and for any other client.
    """
    # ── Jobs ─────────────────────────────────────────────────────────────────
    jobs_active:    int                  # pending + running right now
    jobs_by_status: Dict[str, int]       # every job ever recorded
    recent_jobs:    List[IngestJobSummary]

    # Live pipeline stages for the run currently in flight; empty when idle.
    active_job_id:      Optional[int] = None
    active_job_kind:    Optional[str] = None  # combined | mail | attachments
    active_stages:      List[StageProgress] = []
    active_log:         List[LogLine] = []
    active_elapsed_ms:  Optional[int] = None
    ocr_available:      bool = False

    # ── What is actually searchable ──────────────────────────────────────────
    indexed_chunks:     int              # total Qdrant points across collections
    body_chunks:        int
    attachment_chunks:  int
    collections:        Dict[str, Any]   # raw per-collection detail

    # ── Freshness ────────────────────────────────────────────────────────────
    last_synced_at: Optional[str] = None  # sync cursor; None = never run

    # ── How it is configured ─────────────────────────────────────────────────
    embed_model:   str
    chunk_size:    int
    chunk_overlap: int
    max_workers:   int

    # ── Reachability ─────────────────────────────────────────────────────────
    qdrant_ok:   bool
    qdrant_error: str = ""


# ── Emails ────────────────────────────────────────────────────────────────────

class EmailSummary(BaseModel):
    email_id:   str
    subject:    str
    from_addr:  str
    date:       str
    chunk_count: int


class EmailListResponse(BaseModel):
    emails:  List[EmailSummary]
    total:   int
    page:    int
    limit:   int


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status:   str
    qdrant:   Dict[str, Any]
    ollama:   Dict[str, Any]
    database: Dict[str, Any]
    model:    str
