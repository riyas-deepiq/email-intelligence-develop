# =============================================================================
# api/routes/ingest.py — Ingestion endpoints
# =============================================================================
from __future__ import annotations

import asyncio
import json
import logging
import threading
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from api.models import (
    IndexOverviewResponse,
    IngestAttachmentsRequest,
    IngestJobSummary,
    IngestPostgresRequest,
    IngestStatusResponse,
    LogLine,
    StageProgress,
)
from db.crud import (
    count_ingest_jobs_by_status,
    create_ingest_job,
    get_ingest_job,
    get_sync_cursor,
    list_ingest_jobs,
    update_ingest_job,
)
from db.session import get_db
from ingestion.progress import StageTracker

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])

# In-memory state for lightweight job tracking (complements DB records)
_jobs: dict[int, dict] = {}

# Live per-stage progress, keyed by job id. Kept separate from _jobs because
# _jobs entries are replaced wholesale at each status transition, which would
# drop the tracker mid-run. In-memory by design: this is second-by-second state,
# not history — the DB row is what survives a restart.
_trackers: dict[int, StageTracker] = {}

# One monotonically increasing revision lets all SSE clients sleep until the
# ingestion worker records a real state change. A timeout is used only to send
# an SSE keepalive through proxies; it does not refresh or recompute state.
_pipeline_condition = threading.Condition()
_pipeline_revision = 0

# Every unscoped run shares global message/attachment cursors and rewrites the
# same Qdrant points. Serializing jobs prevents overlapping mailbox completions
# from racing delete/upsert operations or advancing the cursors out of order.
_postgres_ingestion_lock = threading.Lock()


def _signal_pipeline_change() -> None:
    global _pipeline_revision
    with _pipeline_condition:
        _pipeline_revision += 1
        _pipeline_condition.notify_all()


def _current_pipeline_revision() -> int:
    with _pipeline_condition:
        return _pipeline_revision


def _wait_for_pipeline_change(revision: int, timeout: float = 15.0) -> int:
    with _pipeline_condition:
        _pipeline_condition.wait_for(
            lambda: _pipeline_revision != revision,
            timeout=timeout,
        )
        return _pipeline_revision


def _set_job_state(job_id: int, state: dict) -> None:
    global _pipeline_revision
    with _pipeline_condition:
        _jobs[job_id] = state
        _pipeline_revision += 1
        _pipeline_condition.notify_all()


def _register_tracker(job_id: int, job_kind: str) -> None:
    global _pipeline_revision
    tracker = StageTracker(job_kind=job_kind, on_change=_signal_pipeline_change)
    with _pipeline_condition:
        _trackers[job_id] = tracker
        _pipeline_revision += 1
        _pipeline_condition.notify_all()


def _live_pipeline_snapshot() -> dict:
    """Return the inexpensive in-memory state used by the live dashboard."""
    from ingestion.attachment_parser import AttachmentParser

    # Copy references while holding the condition lock so worker transitions
    # cannot resize either dictionary during iteration. StageTracker supplies
    # its own lock for the detailed snapshot below.
    with _pipeline_condition:
        jobs = {job_id: dict(state) for job_id, state in _jobs.items()}
        trackers = dict(_trackers)

    running_ids = {
        job_id for job_id, state in jobs.items()
        if state.get("status") == "running"
    }
    pending_ids = {
        job_id for job_id, state in jobs.items()
        if state.get("status") == "pending"
    }
    active_ids = running_ids | pending_ids
    active_job_id = (
        max(running_ids)
        if running_ids
        else min(pending_ids) if pending_ids else None
    )

    # Once idle, retain the last run so its completed stages and log remain
    # visible until a new job starts.
    if active_job_id is None and trackers:
        active_job_id = max(trackers)

    tracker = trackers.get(active_job_id) if active_job_id is not None else None
    state = jobs.get(active_job_id, {}) if active_job_id is not None else {}

    return {
        "connected": True,
        "activeJobId": active_job_id,
        "activeJobKind": state.get("kind"),
        "jobsActive": len(active_ids),
        "stages": tracker.snapshot() if tracker else [],
        "log": tracker.log_lines(200) if tracker else [],
        "elapsedMs": tracker.run_elapsed_ms() if tracker else None,
        "ocrAvailable": AttachmentParser.ocr_available(),
    }


def _stages_for(job_id: int) -> list[StageProgress]:
    tracker = _trackers.get(job_id)
    return [StageProgress(**s) for s in tracker.snapshot()] if tracker else []


def _log_for(job_id: int, limit: int = 200) -> list[LogLine]:
    tracker = _trackers.get(job_id)
    return [LogLine(**ln) for ln in tracker.log_lines(limit)] if tracker else []


def _run_postgres_ingestion(
    job_id: int,
    mailbox_id: Optional[str],
    org_id: Optional[str],
    since: Optional[str],
    full_resync: bool,
    clear: bool,
    max_workers: Optional[int],
) -> None:
    """Background task: vectorizes new Postgres messages and their attachments."""
    from datetime import datetime
    from config import settings
    from db.session import SessionLocal
    from db.crud import update_ingest_job as _update
    from ingestion.pipeline import IngestionPipeline

    db = SessionLocal()
    try:
        _update(db, job_id, status="running", progress="Starting mail and attachment ingestion…")
        _set_job_state(job_id, {"kind": "combined", "status": "running", "progress": "Starting mail and attachment processing…", "points": 0})
        tracker = _trackers.get(job_id)
        if tracker:
            scope = mailbox_id or org_id or "all mailboxes"
            tracker.log(f"Mail & attachment run #{job_id} started — scope: {scope}"
                        f"{', full resync' if full_resync else ''}"
                        f"{', collections cleared' if clear else ''}")

        since_dt = datetime.fromisoformat(since) if since else None
        pipeline = IngestionPipeline(clear_collections=clear, progress=_trackers.get(job_id))
        mail_total = pipeline.ingest_from_postgres(
            since=since_dt,
            mailbox_id=mailbox_id,
            org_id=org_id,
            use_cursor=not full_resync,
            max_workers=max_workers if max_workers is not None else settings.ingest_max_workers,
            finish_progress=False,
        )
        if tracker:
            tracker.log(f"Mail pass complete — {mail_total} passage(s) indexed; checking attachments.")

        attachment_total = pipeline.ingest_attachments_from_postgres(
            since=since_dt,
            mailbox_id=mailbox_id,
            org_id=org_id,
            use_cursor=not full_resync,
            max_workers=max_workers if max_workers is not None else settings.ingest_max_workers,
            finish_progress=False,
        )
        total = mail_total + attachment_total

        if tracker:
            tracker.finish(
                f"Run #{job_id} finished — {mail_total} mail and "
                f"{attachment_total} attachment passage(s) indexed."
            )
        _update(db, job_id, status="done", progress=f"Done — {total} chunk(s) upserted.", points=total)
        _set_job_state(job_id, {"kind": "combined", "status": "done", "progress": f"Done — {total} chunks upserted.", "points": total})
        logger.info(
            "Combined Postgres ingestion job %d complete: %d mail + %d attachment points",
            job_id, mail_total, attachment_total,
        )

    except Exception as exc:
        logger.error("Postgres ingestion job %d failed: %s", job_id, exc)
        _update(db, job_id, status="error", error=str(exc), progress="Ingestion failed.")
        _set_job_state(job_id, {"kind": "combined", "status": "error", "progress": "Failed.", "error_msg": str(exc), "points": 0})
        # Settle the stage display: the pipeline raised before its own
        # finish(), so without this a failed run leaves a stage stuck on
        # "Working" in the dashboard forever.
        tracker = _trackers.get(job_id)
        if tracker:
            tracker.finish(f"Run #{job_id} failed — {exc}", level="error")
    finally:
        db.close()


def _run_serialized_postgres_ingestion(*args) -> None:
    """Run one combined job at a time so cursor and Qdrant writes cannot race."""
    with _postgres_ingestion_lock:
        _run_postgres_ingestion(*args)


def _run_attachment_ingestion(
    job_id: int,
    mailbox_id: Optional[str],
    org_id: Optional[str],
    since: Optional[str],
    full_resync: bool,
    max_workers: Optional[int],
) -> None:
    """Background task: runs IngestionPipeline against the Postgres `attachments` table."""
    from datetime import datetime
    from config import settings
    from db.session import SessionLocal
    from db.crud import update_ingest_job as _update
    from ingestion.pipeline import IngestionPipeline

    db = SessionLocal()
    try:
        _update(db, job_id, status="running", progress="Starting attachment ingestion…")
        _set_job_state(job_id, {"kind": "attachments", "status": "running", "progress": "Starting image and attachment processing…", "points": 0})
        tracker = _trackers.get(job_id)
        if tracker:
            scope = mailbox_id or org_id or "all mailboxes"
            tracker.log(
                f"Image & attachment run #{job_id} started — scope: {scope}"
                f"{', full resync' if full_resync else ''}"
            )

        since_dt = datetime.fromisoformat(since) if since else None
        pipeline = IngestionPipeline(progress=tracker)
        total = pipeline.ingest_attachments_from_postgres(
            since=since_dt,
            mailbox_id=mailbox_id,
            org_id=org_id,
            use_cursor=not full_resync,
            max_workers=max_workers if max_workers is not None else settings.ingest_max_workers,
        )

        _update(db, job_id, status="done", progress=f"Done — {total} chunk(s) upserted.", points=total)
        _set_job_state(job_id, {"kind": "attachments", "status": "done", "progress": f"Done — {total} chunks upserted.", "points": total})
        logger.info("Attachment ingestion job %d complete: %d points", job_id, total)

    except Exception as exc:
        logger.error("Attachment ingestion job %d failed: %s", job_id, exc)
        _update(db, job_id, status="error", error=str(exc), progress="Ingestion failed.")
        _set_job_state(job_id, {"kind": "attachments", "status": "error", "progress": "Failed.", "error_msg": str(exc), "points": 0})
        tracker = _trackers.get(job_id)
        if tracker:
            tracker.finish(f"Image & attachment run #{job_id} failed — {exc}", level="error")
    finally:
        db.close()


def _run_serialized_attachment_ingestion(*args) -> None:
    """Keep the legacy repair endpoint from overlapping a combined run."""
    with _postgres_ingestion_lock:
        _run_attachment_ingestion(*args)


@router.post(
    "/attachments",
    summary="Repair/reindex attachment content only",
    deprecated=True,
)
async def ingest_attachments(
    body: IngestAttachmentsRequest,
    db:   Session = Depends(get_db),
):
    """Start vectorizing attachment content (fetched live per-attachment via the Core Server)."""
    job = create_ingest_job(db)
    _set_job_state(job.id, {"kind": "attachments", "status": "pending", "progress": "Queued", "points": 0})
    _register_tracker(job.id, "attachments")

    thread = threading.Thread(
        target=_run_serialized_attachment_ingestion,
        args=(job.id, body.mailbox_id, body.org_id, body.since, body.full_resync, body.max_workers),
        daemon=True,
    )
    thread.start()

    return {"message": "Attachment ingestion started.", "job_id": job.id}


@router.post("/postgres", summary="Vectorize new mail and attachments from Postgres")
async def ingest_postgres(
    body: IngestPostgresRequest,
    db:   Session = Depends(get_db),
):
    """Start one incremental run covering both message bodies and attachments."""
    job = create_ingest_job(db)
    _set_job_state(job.id, {"kind": "combined", "status": "pending", "progress": "Queued", "points": 0})
    _register_tracker(job.id, "combined")

    thread = threading.Thread(
        target=_run_serialized_postgres_ingestion,
        args=(job.id, body.mailbox_id, body.org_id, body.since, body.full_resync, body.clear, body.max_workers),
        daemon=True,
    )
    thread.start()

    return {"message": "Mail and attachment ingestion queued.", "job_id": job.id}


@router.get("/status/{job_id}", response_model=IngestStatusResponse, summary="Poll ingestion status")
async def ingest_status(job_id: int, db: Session = Depends(get_db)):
    """Poll the progress of an ingestion job."""
    # Prefer in-memory state (more up-to-date than DB during active run)
    if job_id in _jobs:
        state = _jobs[job_id]
        return IngestStatusResponse(
            job_id=job_id,
            status=state.get("status", "unknown"),
            progress=state.get("progress", ""),
            points=state.get("points", 0),
            error_msg=state.get("error_msg", ""),
            stages=_stages_for(job_id),
        )
    # Fall back to DB
    job = get_ingest_job(db, job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    return IngestStatusResponse(
        job_id=job.id,
        status=job.status,
        progress=job.progress,
        points=job.points,
        error_msg=job.error_msg,
        stages=_stages_for(job.id),
    )


@router.get("/live/events", summary="Stream live vector-processing changes")
async def ingest_events(request: Request):
    """Push one snapshot per real pipeline change; comments keep proxies alive."""

    async def event_stream():
        revision = _current_pipeline_revision()
        initial = json.dumps(
            _live_pipeline_snapshot(),
            separators=(",", ":"),
            ensure_ascii=False,
        )
        yield f"event: pipeline\ndata: {initial}\n\n"

        while not await request.is_disconnected():
            next_revision = await asyncio.to_thread(
                _wait_for_pipeline_change,
                revision,
                15.0,
            )
            if await request.is_disconnected():
                break
            if next_revision == revision:
                # An SSE comment prevents idle reverse proxies from closing the
                # connection. It is not a data event and causes no UI render.
                yield ": keepalive\n\n"
                continue

            # A short coalescing window turns bursts from worker threads into a
            # readable update without losing the latest counts or log entries.
            await asyncio.sleep(0.15)
            revision = _current_pipeline_revision()
            payload = json.dumps(
                _live_pipeline_snapshot(),
                separators=(",", ":"),
                ensure_ascii=False,
            )
            yield f"event: pipeline\ndata: {payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/overview", response_model=IndexOverviewResponse,
            summary="Index and ingestion-job overview for the dashboard")
async def ingest_overview(recent: int = 10, db: Session = Depends(get_db)):
    """
    One call giving the Core Server everything it needs to render the search-index
    panel: how many indexing runs are in flight, what has been indexed, how fresh
    it is, and how the pipeline is configured.

    Qdrant being unreachable is reported in the payload rather than raised: a
    dashboard that shows "index unavailable" is far more useful than one that
    shows an error toast and no numbers at all.
    """
    from config import settings
    from ingestion.attachment_parser import AttachmentParser
    from vector_store.qdrant_client import EmailQdrantClient

    # ── Jobs ─────────────────────────────────────────────────────────────────
    rows = list_ingest_jobs(db, limit=max(1, min(recent, 50)))

    recent_jobs: list[IngestJobSummary] = []
    for job in rows:
        # The in-memory record is fresher than the DB row while a run is active
        # (the DB is written at transitions, the dict on every update), so it
        # wins where both exist — the same precedence /status/{job_id} uses.
        live = _jobs.get(job.id, {})
        recent_jobs.append(IngestJobSummary(
            job_id     = job.id,
            status     = live.get("status")   or job.status,
            progress   = live.get("progress") or job.progress or "",
            points     = live.get("points")   if live.get("points") is not None else (job.points or 0),
            error_msg  = live.get("error_msg") or job.error_msg or "",
            created_at = job.created_at.isoformat() if job.created_at else None,
            updated_at = job.updated_at.isoformat() if job.updated_at else None,
        ))

    by_status = count_ingest_jobs_by_status(db)
    # Count in flight from the reconciled view, not the raw DB counts: a job
    # that finished since its row was last written would otherwise still read
    # as running.
    running_ids = {j.job_id for j in recent_jobs if j.status == "running"}
    pending_ids = {j.job_id for j in recent_jobs if j.status == "pending"}
    for job_id, state in _jobs.items():
        if state.get("status") == "running":
            running_ids.add(job_id)
            pending_ids.discard(job_id)
        elif state.get("status") == "pending" and job_id not in running_ids:
            pending_ids.add(job_id)
    active_ids = running_ids | pending_ids
    jobs_active = len(active_ids)

    # Serialized jobs may queue behind the current run. Always show the job
    # actually running; only show the oldest queued job when none is running.
    active_job_id = max(running_ids) if running_ids else (min(pending_ids) if pending_ids else None)
    active_stages = _stages_for(active_job_id) if active_job_id is not None else []
    active_log    = _log_for(active_job_id) if active_job_id is not None else []

    # Idle, but the last finished run's stages are still worth showing — they
    # are the record of what that run actually did.
    if active_job_id is None and recent_jobs:
        active_job_id = recent_jobs[0].job_id
        active_stages = _stages_for(active_job_id)
        active_log    = _log_for(active_job_id)

    active_job_kind = (
        _jobs.get(active_job_id, {}).get("kind")
        if active_job_id is not None else None
    )

    # ── Vector store ─────────────────────────────────────────────────────────
    collections: dict = {}
    qdrant_ok, qdrant_error = False, ""
    body_chunks = attachment_chunks = 0
    try:
        collections = EmailQdrantClient().get_collection_info()
        qdrant_ok = not any("error" in v for v in collections.values())
        body_chunks       = int(collections.get(settings.collection_bodies, {}).get("points_count") or 0)
        attachment_chunks = int(collections.get(settings.collection_attachments, {}).get("points_count") or 0)
        if not qdrant_ok:
            qdrant_error = next((v["error"] for v in collections.values() if "error" in v), "")
    except Exception as exc:
        qdrant_error = str(exc)
        logger.warning("Index overview: Qdrant unavailable: %s", exc)

    # ── Freshness ────────────────────────────────────────────────────────────
    try:
        cursor = get_sync_cursor(db, "postgres_messages")
    except Exception:
        cursor = None

    return IndexOverviewResponse(
        jobs_active       = jobs_active,
        jobs_by_status    = by_status,
        recent_jobs       = recent_jobs,
        active_job_id     = active_job_id,
        active_job_kind   = active_job_kind,
        active_stages     = active_stages,
        active_log        = active_log,
        active_elapsed_ms = (_trackers[active_job_id].run_elapsed_ms()
                             if active_job_id in _trackers else None),
        ocr_available     = AttachmentParser.ocr_available(),
        indexed_chunks    = body_chunks + attachment_chunks,
        body_chunks       = body_chunks,
        attachment_chunks = attachment_chunks,
        collections       = collections,
        last_synced_at    = cursor.isoformat() if cursor else None,
        embed_model       = settings.embed_model_name,
        chunk_size        = settings.chunk_size,
        chunk_overlap     = settings.chunk_overlap,
        max_workers       = settings.ingest_max_workers,
        qdrant_ok         = qdrant_ok,
        qdrant_error      = qdrant_error,
    )


@router.post("/upload", summary="Upload and ingest a single .eml file")
async def ingest_upload(
    file: UploadFile = File(...),
    db:   Session = Depends(get_db),
):
    """Upload a single .eml file and ingest it immediately."""
    import tempfile, os, pathlib
    from ingestion.pipeline import IngestionPipeline

    if not file.filename or not file.filename.endswith(".eml"):
        raise HTTPException(status_code=400, detail="Only .eml files are accepted")

    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".eml", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        pipeline = IngestionPipeline()
        upserted = pipeline.ingest_single(tmp_path)
        return {"filename": file.filename, "chunks_upserted": upserted}
    finally:
        os.unlink(tmp_path)
