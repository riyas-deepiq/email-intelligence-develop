# =============================================================================
# ingestion/pipeline.py — Full ingestion orchestrator
# =============================================================================
"""
IngestionPipeline wires together:
  EmlParser → AttachmentParser → EmailChunker → BatchEmbedder → EmailQdrantClient

Two entry-points:
  pipeline.ingest_from_postgres(...)     — bulk ingest from the Core Server's
                                            Postgres `messages` table (primary path)
  pipeline.ingest_single(eml_path)       — ingest one uploaded .eml file (manual/testing)

RBAC department tagging comes from the real org data, not a hardcoded map:
Postgres-sourced messages carry `department` on the ParsedEmail (joined from
`mailboxes.department_name` in ingestion/pg_email_source.py — the mail
provider's synced directory profile for that mailbox), which chunker.py
copies onto every TextChunk. Manually-uploaded single .eml files have no
mailbox to join, so they fall back to "Unknown" (chunker.py's TextChunk
default) — that's an honest gap, not a guess.
"""
from __future__ import annotations

import gc
import logging
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Generator, List, Optional

from config import settings
from ingestion.eml_parser import EmlParser, ParsedEmail, ParsedAttachment
from ingestion.attachment_parser import AttachmentParser
from ingestion.chunker import EmailChunker, TextChunk
from ingestion.progress import StageTracker

logger = logging.getLogger(__name__)


def _extract_emails(text: str) -> List[str]:
    """Extract bare email addresses from a header string."""
    if not text:
        return []
    return [m.lower() for m in re.findall(r"[\w.\-+]+@[\w.\-]+\.\w+", text)]


def _enrich_chunks_rbac(chunks: List[TextChunk]) -> None:
    """Attach sender/recipient RBAC fields to each chunk in-place.

    Department is not touched here — it's already set on each chunk (from
    ParsedEmail.department, via chunker.py) at chunk-creation time.
    """
    for chunk in chunks:
        chunk.rbac_sender = _extract_emails(chunk.from_addr)
        chunk.rbac_to     = _extract_emails(chunk.to_addrs)
        chunk.rbac_cc     = _extract_emails(chunk.cc_addrs)


# ── IngestionPipeline ─────────────────────────────────────────────────────────

class IngestionPipeline:
    """Orchestrates the full email ingestion pipeline."""

    def __init__(
        self,
        clear_collections: bool = False,
        progress: Optional["StageTracker"] = None,
    ):
        self.clear_collections = clear_collections
        # Optional live per-stage reporter (ingestion/progress.py). None keeps
        # the pipeline exactly as it was — every call site below is a no-op.
        self.progress = progress
        self._eml_parser        = EmlParser()
        self._att_parser        = AttachmentParser(
            save_dir=settings.attachments_folder
        )
        self._chunker           = EmailChunker()

        # Lazy-imported to avoid circular deps at module load time
        self._embedder   = None
        self._qdrant     = None
        # Guards the lazy-init below — ingest_from_postgres() may call
        # _get_embedder()/_get_qdrant() from multiple worker threads
        # concurrently (max_workers > 1); without this, two threads racing on
        # the very first call could each construct their own client.
        self._init_lock = threading.Lock()

    def _get_embedder(self):
        if self._embedder is None:
            with self._init_lock:
                if self._embedder is None:
                    from embedding.batch_embedder import BatchEmbedder
                    self._embedder = BatchEmbedder()
        return self._embedder

    def _get_qdrant(self):
        if self._qdrant is None:
            with self._init_lock:
                if self._qdrant is None:
                    from vector_store.qdrant_client import EmailQdrantClient
                    self._qdrant = EmailQdrantClient()
        return self._qdrant

    # ── Public entry-points ───────────────────────────────────────────────────

    def ingest_single(self, eml_path: str) -> int:
        """Ingest a single .eml file."""
        parsed = self._eml_parser.parse_file(eml_path)
        if parsed is None:
            logger.error("Could not parse %s", eml_path)
            return 0
        upserted = self._process_email(parsed)
        gc.collect()
        return upserted

    def ingest_from_postgres(
        self,
        since: Optional[datetime] = None,
        mailbox_id: Optional[str] = None,
        org_id: Optional[str] = None,
        use_cursor: bool = True,
        max_workers: int = 1,
        finish_progress: bool = True,
    ) -> int:
        """
        Ingest messages straight from the Core Server's Postgres `messages`
        table instead of the local .eml folder. Reuses the same chunk → embed
        → Qdrant upsert path as ingest_single(); only the source differs.

        Incremental by default: reads/writes a `rag_sync_cursor` row (source=
        "postgres_messages") so repeated unscoped runs only pick up new/changed
        messages. Pass since=... to query a specific window, or use_cursor=False
        to ignore the stored cursor and scan from the beginning (e.g. a full
        resync).

        Scoped runs (mailbox_id and/or org_id given) never read or advance the
        global cursor: doing so would let a subset run silently skip other
        mailboxes' unprocessed messages on the next unscoped run.

        If ANY message fails this run, the cursor is not advanced at all — the
        next run retries the whole window from the same starting point. This
        is deliberately all-or-nothing rather than a partial advance: once
        messages are processed concurrently (max_workers > 1) they no longer
        finish in (updated_at, id) order, so there's no single safe watermark
        to advance to that wouldn't risk permanently skipping a message that
        happened to fail while a later one succeeded. Re-processing already-
        succeeded messages on retry is safe — delete_email() before every
        upsert makes it idempotent — so this just trades a bit of redundant
        work for never silently losing a message.

        max_workers: number of emails to chunk/embed/upsert concurrently via a
        thread pool. This work is I/O-bound (HTTP calls to Ollama + Qdrant), so
        Python's GIL is released while waiting and threads give real wall-clock
        speedup. Going above Ollama's own concurrency (OLLAMA_NUM_PARALLEL,
        default 4) just queues requests on Ollama's side without extra
        throughput — there's rarely a reason to set this much higher than
        that. max_workers=1 (the default) behaves identically to the old
        purely-sequential loop.

        Returns:
            Total number of Qdrant points upserted.
        """
        from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

        from ingestion.pg_email_source import iter_messages_from_postgres
        from db.session import db_session
        from db.crud import get_sync_cursor, set_sync_cursor

        scoped = bool(mailbox_id or org_id)
        cursor_source = "postgres_messages"
        effective_since = since
        if effective_since is None and use_cursor and not scoped:
            with db_session() as db:
                effective_since = get_sync_cursor(db, cursor_source)

        logger.info(
            "Starting ingestion from Postgres messages (since=%s, mailbox_id=%s, org_id=%s, max_workers=%d)",
            effective_since, mailbox_id, org_id, max_workers,
        )

        if self.clear_collections:
            self._get_qdrant().recreate_collections()

        total = 0
        any_failed = False
        latest_updated_at = effective_since

        def _process_one(parsed_email: ParsedEmail, updated_at: datetime):
            # Qdrant point IDs are random UUIDs (not derived from email_id),
            # so re-running ingestion would duplicate points without this —
            # clear any prior points for this message first (idempotent).
            # Bodies collection only: Postgres-sourced ParsedEmail.attachments
            # is always [] (see pg_email_source.py), so this path never
            # repopulates attachment chunks — clearing email_attachments here
            # too would delete vectors owned by ingest_attachments_from_postgres()
            # and never restore them.
            self._get_qdrant().delete_email(parsed_email.email_id, collections=[settings.collection_bodies])
            return parsed_email.email_id, updated_at, self._process_email(parsed_email)

        def _drain(done_futures) -> None:
            nonlocal total, any_failed, latest_updated_at
            for fut in done_futures:
                try:
                    email_id, msg_updated_at, upserted = fut.result()
                    total += upserted
                    if latest_updated_at is None or msg_updated_at > latest_updated_at:
                        latest_updated_at = msg_updated_at
                    logger.info("  ✅ %s → %d chunk(s) upserted", email_id, upserted)
                except Exception as exc:
                    any_failed = True
                    logger.error("  ❌ Failed message: %s", exc)
                finally:
                    gc.collect()

        # Cap how many parsed emails/futures we hold at once so a huge mailbox
        # doesn't buffer its entire body text in memory — drain periodically
        # instead of submitting everything up front.
        max_in_flight = max(max_workers * 4, max_workers)

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            in_flight = set()
            for parsed_email, updated_at in iter_messages_from_postgres(
                since=effective_since, mailbox_id=mailbox_id, org_id=org_id,
            ):
                if self.progress:
                    self.progress.advance("read")
                    self.progress.add("read", 1)
                in_flight.add(pool.submit(_process_one, parsed_email, updated_at))
                if len(in_flight) >= max_in_flight:
                    done, in_flight = wait(in_flight, return_when=FIRST_COMPLETED)
                    _drain(done)
            _drain(in_flight)

        if scoped:
            pass  # scoped runs never touch the global cursor (see docstring)
        elif any_failed:
            logger.warning(
                "At least one message failed this run — sync cursor NOT advanced, "
                "so the next run retries the whole window (safe: re-ingestion is idempotent)."
            )
        elif latest_updated_at is not None:
            with db_session() as db:
                set_sync_cursor(db, cursor_source, latest_updated_at)

        if self.progress and finish_progress:
            self.progress.finish()

        logger.info("Postgres ingestion complete. Total upserted: %d", total)
        return total

    def ingest_attachments_from_postgres(
        self,
        since: Optional[datetime] = None,
        mailbox_id: Optional[str] = None,
        org_id: Optional[str] = None,
        use_cursor: bool = True,
        max_workers: int = 1,
        finish_progress: bool = True,
    ) -> int:
        """
        Vectorize attachment *content* from the Core Server's Postgres
        `attachments` table into the email_attachments Qdrant collection.

        `attachments` only holds metadata (filename/content-type/size) — bytes
        are fetched live per-attachment via attachment_downloader.fetch_attachment()
        (calls the Core Server's internal RAG channel, which downloads from the
        mail provider on demand). Temporary download failures hold the cursor
        so they are retried, while provider-confirmed permanent failures
        (deleted/stale objects or unsupported attachment kinds) are skipped so
        one bad metadata row cannot pin every later attachment forever.

        That distinction matters: a whole run can "succeed" having downloaded
        nothing (Core Server unreachable, secret mismatch, dead provider
        connection). Advancing the cursor there would skip past every one of
        those attachments permanently, and the symptom — zero attachment
        chunks, no error anywhere — gives no hint why.

        An attachment that downloads fine but yields no text (a scanned PDF
        with no OCR available, an unsupported format) is NOT a failure. There
        is genuinely nothing to index, and re-running would produce nothing
        again, so it must not pin the cursor in place forever.

        Mirrors ingest_from_postgres()'s incremental-cursor / concurrency /
        all-or-nothing-cursor-advance design (see that method's docstring for
        the full reasoning) with its own cursor source, "postgres_attachments",
        keyed on attachments.created_at instead of messages.updated_at.
        """
        from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

        from ingestion.pg_attachment_source import iter_attachments_from_postgres
        from ingestion.attachment_downloader import fetch_attachment
        from db.session import db_session
        from db.crud import get_sync_cursor, set_sync_cursor

        scoped = bool(mailbox_id or org_id)
        cursor_source = "postgres_attachments"
        effective_since = since
        if effective_since is None and use_cursor and not scoped:
            with db_session() as db:
                effective_since = get_sync_cursor(db, cursor_source)

        logger.info(
            "Starting attachment ingestion from Postgres (since=%s, mailbox_id=%s, org_id=%s, max_workers=%d)",
            effective_since, mailbox_id, org_id, max_workers,
        )

        total = 0
        any_failed = False
        seen = 0
        download_failures = 0
        unavailable = 0
        latest_created_at = effective_since

        # (attachment_id, created_at, chunks_upserted, outcome, reason)
        def _process_one(att_row, parsed_email: ParsedEmail, created_at: datetime):
            attachment_id = str(att_row["id"])
            # The attachment-specific tracker labels this as files and exposes
            # OCR separately from the later vectorization stages.
            p = self.progress

            if p:
                p.advance("read")
                p.add("read", 1)

            fetched = fetch_attachment(attachment_id)
            raw = fetched.attachment
            if raw is None:
                if fetched.retryable:
                    # Preserve any vectors from an earlier successful run. A
                    # temporary provider outage must never erase searchable
                    # content before a replacement has been built.
                    if p:
                        p.log(
                            f"{att_row['name']} — download failed: {fetched.reason}",
                            level="error",
                        )
                    return attachment_id, created_at, 0, "retry", fetched.reason

                # The provider confirmed this object cannot be downloaded
                # (deleted/stale ID or unsupported attachment kind). Remove a
                # stale prior vector and let the cursor pass it permanently.
                self._get_qdrant().delete_attachment(attachment_id)
                if p:
                    p.log(
                        f"{att_row['name']} — skipped: {fetched.reason}",
                        level="warn",
                    )
                return attachment_id, created_at, 0, "unavailable", fetched.reason

            is_image = self._att_parser.is_image(raw.filename)
            if p:
                p.advance("extract")
                p.log(
                    f"{raw.filename} — {'image OCR' if is_image else 'text extraction'} started"
                )
            # save=False: this is downloaded provider content, not a local
            # upload — never persist it to data/attachments/ (see
            # AttachmentParser.parse()'s docstring for why that's safe).
            att_text = self._att_parser.parse(raw, save=False)
            if not att_text.strip():
                self._get_qdrant().delete_attachment(attachment_id)
                logger.info("  ⊘ attachment %s (%s) — no extractable text", attachment_id, raw.filename)
                if p:
                    p.log(
                        f"{raw.filename} — "
                        f"{'OCR found no readable text' if is_image else 'no readable text'}",
                        level="warn",
                    )
                return attachment_id, created_at, 0, "done", ""
            if p:
                p.add("extract", 1)
                p.log(
                    f"{raw.filename} — "
                    f"{'OCR' if is_image else 'extraction'} produced {len(att_text):,} characters"
                )

            if p: p.advance("chunk")
            att_chunks = self._chunker.chunk_attachment(
                att_text, parsed_email, raw.filename, attachment_id=attachment_id
            )
            if not att_chunks:
                self._get_qdrant().delete_attachment(attachment_id)
                return attachment_id, created_at, 0, "done", ""
            if p: p.add("chunk", len(att_chunks))

            _enrich_chunks_rbac(att_chunks)
            if p: p.advance("embed")
            embedded = self._get_embedder().embed_chunks(att_chunks)
            if p: p.add("embed", len(embedded))

            if p: p.advance("store")
            # Do not remove the prior searchable version until download,
            # extraction and embedding have all succeeded.
            self._get_qdrant().delete_attachment(attachment_id)
            n = self._get_qdrant().upsert_attachment_chunks(embedded)
            if p: p.add("store", n)
            del embedded
            return attachment_id, created_at, n, "done", ""

        def _drain(done_futures) -> None:
            nonlocal total, any_failed, latest_created_at, seen, download_failures, unavailable
            for fut in done_futures:
                seen += 1
                try:
                    attachment_id, created_at, n, outcome, reason = fut.result()
                    if outcome == "retry":
                        any_failed = True
                        download_failures += 1
                        logger.warning(
                            "  ❌ attachment %s — download failed (%s), will retry next run",
                            attachment_id,
                            reason,
                        )
                        continue
                    if outcome == "unavailable":
                        unavailable += 1
                        logger.warning(
                            "  ⊘ attachment %s — permanently skipped (%s)",
                            attachment_id,
                            reason,
                        )
                    total += n
                    if latest_created_at is None or created_at > latest_created_at:
                        latest_created_at = created_at
                    if outcome == "done":
                        logger.info("  ✅ attachment %s → %d chunk(s) upserted", attachment_id, n)
                except Exception as exc:
                    any_failed = True
                    logger.error("  ❌ Failed attachment: %s", exc)
                finally:
                    gc.collect()

        max_in_flight = max(max_workers * 4, max_workers)

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            in_flight = set()
            for att_row, parsed_email, created_at in iter_attachments_from_postgres(
                since=effective_since, mailbox_id=mailbox_id, org_id=org_id,
            ):
                in_flight.add(pool.submit(_process_one, att_row, parsed_email, created_at))
                if len(in_flight) >= max_in_flight:
                    done, in_flight = wait(in_flight, return_when=FIRST_COMPLETED)
                    _drain(done)
            _drain(in_flight)

        if scoped:
            pass  # scoped runs never touch the global cursor (see docstring)
        elif any_failed:
            logger.warning(
                "At least one attachment failed this run — sync cursor NOT advanced, "
                "so the next run retries the whole window (safe: re-ingestion is idempotent)."
            )
        elif latest_created_at is not None:
            with db_session() as db:
                set_sync_cursor(db, cursor_source, latest_created_at)

        # Say why a run produced nothing, rather than reporting a bare 0 —
        # "none reached me" and "none could be downloaded" need different fixes.
        if seen == 0:
            logger.warning(
                "No attachments matched. Either none are indexable (all inline, or none synced yet) "
                "or the cursor is already past them — re-run with use_cursor=False / --full-resync."
            )
        elif download_failures == seen:
            logger.error(
                "All %d attachment(s) failed to download. Check CORE_SERVER_URL (%s) is reachable "
                "and RAG_INTERNAL_SECRET matches the Core Server's RAG_API_SECRET.",
                seen, settings.core_server_url,
            )
            raise RuntimeError(
                f"All {seen} attachment download(s) failed; the attachment cursor was not advanced"
            )
        elif total == 0 and seen - download_failures - unavailable > 0:
            logger.warning(
                "%d attachment(s) downloaded but produced no text — unsupported formats, or scanned "
                "files needing OCR (the `tesseract` binary must be installed, not just pytesseract).",
                seen - download_failures - unavailable,
            )

        if self.progress and finish_progress:
            self.progress.finish(
                f"Attachment run finished — {seen} seen, {download_failures} temporary failure(s), "
                f"{unavailable} unavailable file(s) skipped, {total} passage(s) indexed.",
                level="error" if download_failures == seen and seen > 0 else "info",
            )

        logger.info(
            "Postgres attachment ingestion complete. %d seen, %d temporary failure(s), "
            "%d unavailable skipped, %d chunk(s) upserted.",
            seen, download_failures, unavailable, total,
        )
        return total

    # ── Internal ──────────────────────────────────────────────────────────────

    def _process_email(self, parsed: ParsedEmail) -> int:
        """Process one email: chunk, embed, upsert. Returns points count."""
        total = 0
        p = self.progress

        # ── Body chunks ───────────────────────────────────────────────────────
        if p: p.advance("chunk")
        body_chunks = self._chunker.chunk_email_body(parsed)
        if body_chunks:
            if p: p.add("chunk", len(body_chunks))
            _enrich_chunks_rbac(body_chunks)
            if p: p.advance("embed")
            embedded = self._get_embedder().embed_chunks(body_chunks)
            if p: p.add("embed", len(embedded))
            if p: p.advance("store")
            n = self._get_qdrant().upsert_email_chunks(embedded)
            total += n
            if p: p.add("store", n)
            del embedded

        # ── Attachment chunks ─────────────────────────────────────────────────
        # Runs after the body is already stored, which is why StageTracker's
        # state is monotonic — otherwise the display would jump backwards here.
        for att in parsed.attachments:
            try:
                if p: p.advance("extract")
                att_text = self._att_parser.parse(att)
                if not att_text.strip():
                    continue
                if p: p.add("extract", 1)
                att_chunks = self._chunker.chunk_attachment(att_text, parsed, att.filename)
                if att_chunks:
                    if p: p.add("chunk", len(att_chunks))
                    _enrich_chunks_rbac(att_chunks)
                    embedded = self._get_embedder().embed_chunks(att_chunks)
                    if p: p.add("embed", len(embedded))
                    n = self._get_qdrant().upsert_attachment_chunks(embedded)
                    total += n
                    if p: p.add("store", n)
                    del embedded
            except Exception as exc:
                logger.warning("Attachment processing failed for %s: %s", att.filename, exc)

        gc.collect()
        return total
