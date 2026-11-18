# =============================================================================
# ingestion/pg_attachment_source.py — Stream attachment metadata from Postgres
# =============================================================================
"""
Reads rows from `attachments` (metadata only — filename/content-type/size,
see server/src/db/schema.ts), joined with their parent `messages`/`mailboxes`/
`threads` the same way pg_email_source.py joins for message bodies, and yields
them alongside a ParsedEmail carrying the parent message's context (subject,
from/to, department, mailbox/org scope) so chunker.chunk_attachment() can
enrich each chunk exactly like the eml-sourced attachment path does.

Attachment *bytes* are never in this table — see attachment_downloader.py,
which fetches them live from the Core Server's internal RAG channel per
attachment, on demand during ingestion.

Inline attachments (signature images, embedded logos) are excluded — same
`is_inline = false` filter the Core Server's own attachment listing uses.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Generator, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.engine import RowMapping

from db.session import engine
from ingestion.eml_parser import ParsedEmail
from ingestion.pg_email_source import _format_addresses, _merge_recipients

logger = logging.getLogger(__name__)

_BATCH_SIZE = 500
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_NIL_UUID = "00000000-0000-0000-0000-000000000000"


def iter_attachments_from_postgres(
    since: Optional[datetime] = None,
    mailbox_id: Optional[str] = None,
    org_id: Optional[str] = None,
    batch_size: int = _BATCH_SIZE,
) -> Generator[Tuple[RowMapping, ParsedEmail, datetime], None, None]:
    """
    Stream (attachment_row, parent_email, created_at) tuples ordered by
    (attachments.created_at, attachments.id) — stable keyset pagination, same
    pattern as pg_email_source.iter_messages_from_postgres().

    attachment_row carries the fields the caller needs to download + label
    the attachment: id, name, content_type. parent_email is a ParsedEmail
    with attachments=[] — used only for its header context (subject/from/
    date/department/mailbox_id/org_id) when chunking.
    """
    last_created_at = since or _EPOCH
    last_id = _NIL_UUID

    # See pg_email_source.py's identical note: use CAST(:param AS type), not
    # `:param::type` — SQLAlchemy's text() parser mistreats the latter.
    where_clauses = [
        "a.is_inline = false",
        "(a.created_at, a.id) > (CAST(:last_created_at AS timestamptz), CAST(:last_id AS uuid))",
    ]
    params: dict = {"limit": batch_size}
    if mailbox_id:
        where_clauses.append("m.mailbox_id = CAST(:mailbox_id AS uuid)")
        params["mailbox_id"] = mailbox_id
    if org_id:
        where_clauses.append("m.org_id = CAST(:org_id AS uuid)")
        params["org_id"] = org_id

    query = text(f"""
        SELECT a.id, a.name, a.content_type, a.created_at,
               m.id AS message_id, m.mailbox_id, m.org_id, m.thread_id, m.subject,
               m.from_address, m.from_name, m.to_addresses, m.cc_addresses,
               m.received_at,
               mb.department_name,
               t.subject AS thread_subject, t.participant_emails
        FROM attachments a
        JOIN messages m ON m.id = a.message_id
        JOIN mailboxes mb ON mb.id = m.mailbox_id
        LEFT JOIN threads t ON t.id = m.thread_id
        WHERE {' AND '.join(where_clauses)}
        ORDER BY a.created_at ASC, a.id ASC
        LIMIT :limit
    """)

    total_yielded = 0
    while True:
        params["last_created_at"] = last_created_at
        params["last_id"] = last_id

        with engine.connect() as conn:
            rows = conn.execute(query, params).mappings().all()

        if not rows:
            break

        for row in rows:
            from_addr = row["from_address"] or ""
            if row["from_name"]:
                from_addr = f"{row['from_name']} <{from_addr}>"

            parsed_email = ParsedEmail(
                email_id=str(row["message_id"]),
                file_path=f"postgres://messages/{row['message_id']}",
                subject=(row["subject"] or row["thread_subject"] or ""),
                from_addr=from_addr[:200],
                to_addrs=_merge_recipients(row["to_addresses"], row["participant_emails"])[:500],
                cc_addrs=_format_addresses(row["cc_addresses"])[:500],
                date=row["received_at"].isoformat() if row["received_at"] else "",
                thread_id=str(row["thread_id"]) if row["thread_id"] else "",
                department=row["department_name"] or "",
                mailbox_id=str(row["mailbox_id"]),
                org_id=str(row["org_id"]),
            )
            yield row, parsed_email, row["created_at"]
            total_yielded += 1

        last_row = rows[-1]
        last_created_at = last_row["created_at"]
        last_id = str(last_row["id"])

        if len(rows) < batch_size:
            break

    logger.info("Streamed %d attachment(s) from Postgres", total_yielded)
