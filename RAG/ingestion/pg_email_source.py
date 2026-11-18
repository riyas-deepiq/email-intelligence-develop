# =============================================================================
# ingestion/pg_email_source.py — Stream emails from the Core Server's Postgres
# =============================================================================
"""
Reads rows from `messages`, joined with `mailboxes` and `threads` (all owned
by the Node/Drizzle Core Server — see server/src/db/schema.ts), and yields
them as ParsedEmail objects, so the rest of the ingestion pipeline (chunker,
RBAC enrichment, embedder, Qdrant upsert) needs no changes — Postgres is the
sole bulk-ingestion source (the old .eml-folder bulk path has been removed;
ingest_single() still exists for one-off manual/testing uploads).

Why the joins:
- `mailboxes.department_name` is the mail provider's synced directory profile
  for that mailbox (Azure AD / Google Workspace "department" field) — this is
  the real per-message department for RBAC tagging, replacing what used to be
  a hardcoded {email: department} map in pipeline.py.
- `threads.participant_emails` is the full roster of everyone on a
  conversation, not just whoever happens to be in To/Cc on one specific
  message in it. Being a thread participant is being a legitimate recipient
  for RBAC purposes, so it's merged into the recipient list.
- `threads.subject` is a fallback for messages with a blank `subject` (replies
  sometimes drop it; the thread always carries the original one).

Note: `attachments` in Postgres is metadata only (filename/content-type/size —
see schema comment "not file bytes"); attachment bytes are fetched live from
the provider by the Core Server on demand and are not persisted anywhere yet.
So messages sourced from Postgres always yield zero ParsedAttachment objects —
only the email body is vectorized. Wiring attachment content in would require
calling the Core Server's attachment-download endpoint (or waiting on the
planned MinIO object store), which is a separate piece of work.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Generator, Optional, Tuple

from sqlalchemy import text

from db.session import engine
from ingestion.eml_parser import ParsedEmail

logger = logging.getLogger(__name__)

_BATCH_SIZE = 500
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def _format_addresses(addresses: Optional[list]) -> str:
    """Flatten a jsonb EmailAddress[] column (`[{"email":..,"name":..}]`) into a
    comma-joined string, matching the format `_extract_emails()` expects."""
    if not addresses:
        return ""
    return ", ".join(
        a.get("email", "") for a in addresses if isinstance(a, dict) and a.get("email")
    )


def _merge_recipients(to_addresses: Optional[list], participant_emails: Optional[list]) -> str:
    """Union of the message's own To addresses and the thread's full
    participant roster, deduplicated, order preserved (message's To first)."""
    seen: set = set()
    ordered: list = []

    for a in (to_addresses or []):
        if isinstance(a, dict):
            email = (a.get("email") or "").strip().lower()
            if email and email not in seen:
                seen.add(email)
                ordered.append(email)

    for email in (participant_emails or []):
        if isinstance(email, str):
            e = email.strip().lower()
            if e and e not in seen:
                seen.add(e)
                ordered.append(e)

    return ", ".join(ordered)


def iter_messages_from_postgres(
    since: Optional[datetime] = None,
    mailbox_id: Optional[str] = None,
    org_id: Optional[str] = None,
    batch_size: int = _BATCH_SIZE,
) -> Generator[Tuple[ParsedEmail, datetime], None, None]:
    """
    Stream messages from Postgres ordered by (updated_at, id) — stable keyset
    pagination so nothing is skipped or double-counted across batches, and the
    whole table is never held in memory at once (one message at a time).

    Yields (ParsedEmail, updated_at) tuples — the caller needs updated_at to
    advance its own sync cursor; it isn't a ParsedEmail field.
    """
    last_updated_at = since or _EPOCH
    last_id = _NIL_UUID

    # NOTE: use CAST(:param AS type), not the `:param::type` shorthand — SQLAlchemy's
    # text() bind-parameter parser treats a colon immediately following a parameter
    # name as its own escape sequence and silently declines to treat it as a bind
    # param at all, so `:last_updated_at::timestamptz` gets sent to Postgres as
    # literal text (syntax error) instead of being substituted.
    where_clauses = [
        "(m.updated_at, m.id) > (CAST(:last_updated_at AS timestamptz), CAST(:last_id AS uuid))"
    ]
    params: dict = {"limit": batch_size}
    if mailbox_id:
        where_clauses.append("m.mailbox_id = CAST(:mailbox_id AS uuid)")
        params["mailbox_id"] = mailbox_id
    if org_id:
        where_clauses.append("m.org_id = CAST(:org_id AS uuid)")
        params["org_id"] = org_id

    query = text(f"""
        SELECT m.id, m.mailbox_id, m.org_id, m.thread_id, m.subject,
               m.from_address, m.from_name, m.to_addresses, m.cc_addresses,
               m.body_text, m.received_at, m.updated_at,
               mb.department_name,
               t.subject AS thread_subject, t.participant_emails
        FROM messages m
        JOIN mailboxes mb ON mb.id = m.mailbox_id
        LEFT JOIN threads t ON t.id = m.thread_id
        WHERE {' AND '.join(where_clauses)}
        ORDER BY m.updated_at ASC, m.id ASC
        LIMIT :limit
    """)

    total_yielded = 0
    while True:
        params["last_updated_at"] = last_updated_at
        params["last_id"] = last_id

        with engine.connect() as conn:
            rows = conn.execute(query, params).mappings().all()

        if not rows:
            break

        for row in rows:
            from_addr = row["from_address"] or ""
            if row["from_name"]:
                from_addr = f"{row['from_name']} <{from_addr}>"

            parsed = ParsedEmail(
                email_id=str(row["id"]),
                file_path=f"postgres://messages/{row['id']}",
                subject=(row["subject"] or row["thread_subject"] or ""),
                from_addr=from_addr[:200],
                to_addrs=_merge_recipients(row["to_addresses"], row["participant_emails"])[:500],
                cc_addrs=_format_addresses(row["cc_addresses"])[:500],
                date=row["received_at"].isoformat() if row["received_at"] else "",
                thread_id=str(row["thread_id"]) if row["thread_id"] else "",
                body_text=row["body_text"] or "",
                body_html="",
                attachment_names=[],
                attachments=[],
                raw_headers={},
                department=row["department_name"] or "",
                mailbox_id=str(row["mailbox_id"]),
                org_id=str(row["org_id"]),
            )
            yield parsed, row["updated_at"]
            total_yielded += 1

        last_row = rows[-1]
        last_updated_at = last_row["updated_at"]
        last_id = str(last_row["id"])

        if len(rows) < batch_size:
            break

    logger.info("Streamed %d message(s) from Postgres", total_yielded)
