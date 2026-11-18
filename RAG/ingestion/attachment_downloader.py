# =============================================================================
# ingestion/attachment_downloader.py — Fetch attachment bytes from Core Server
# =============================================================================
"""
Attachment bytes are never persisted in Postgres (see pg_attachment_source.py)
— they're fetched live from the mail provider by the Core Server, same as its
user-facing download route (messages.routes.ts). This calls the Core Server's
internal RAG channel (server/src/modules/internal/rag-internal.routes.ts),
guarded by the same RAG_INTERNAL_SECRET/RAG_API_SECRET shared secret already
used for Server -> RAG query calls, reused here for the reverse direction, to
get one attachment's bytes on demand during ingestion.
"""
from __future__ import annotations

import base64
import logging
import time
from dataclasses import dataclass
from typing import Optional

import requests

from config import settings
from ingestion.eml_parser import ParsedAttachment

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class AttachmentFetchResult:
    """Outcome of fetching provider bytes through the Core Server."""

    attachment: Optional[ParsedAttachment] = None
    retryable: bool = False
    reason: str = ""


def _error_details(resp: requests.Response) -> tuple[str, bool]:
    # Only a missing row/provider object or the Core Server's explicit
    # permanent-unavailable response may pass the cursor. Auth/config errors
    # (401/403) must hold it or an entire mailbox could be silently skipped.
    retryable = resp.status_code not in {404, 410, 422}
    reason = f"HTTP {resp.status_code}"
    try:
        error = resp.json().get("error", {})
        reason = error.get("message") or reason
        retryable = bool(error.get("retryable", retryable))
    except (ValueError, AttributeError):
        pass
    return reason, retryable


def fetch_attachment(attachment_id: str) -> AttachmentFetchResult:
    """
    Download one attachment's bytes by its Postgres `attachments.id`.

    Temporary failures are retried locally. The structured result lets the
    pipeline distinguish a provider object that is permanently unavailable
    from an outage/throttle that must hold the sync cursor for a later retry.
    """
    url = f"{settings.core_server_url}/v1/rag-internal/attachments/{attachment_id}/content"
    headers = {"Authorization": f"Bearer {settings.rag_internal_secret}"}

    for attempt in range(1, _MAX_ATTEMPTS + 1):
        try:
            resp = requests.get(url, headers=headers, timeout=60)
            if resp.ok:
                body = resp.json()["data"]
                return AttachmentFetchResult(attachment=ParsedAttachment(
                    filename=body["name"],
                    content_type=body.get("contentType") or "application/octet-stream",
                    data=base64.b64decode(body["base64"], validate=True),
                ))

            reason, retryable = _error_details(resp)
            if not retryable:
                logger.warning(
                    "Attachment %s is permanently unavailable: %s",
                    attachment_id,
                    reason,
                )
                return AttachmentFetchResult(retryable=False, reason=reason)
            if attempt == _MAX_ATTEMPTS:
                logger.warning(
                    "Attachment download failed for %s after %d attempts: %s",
                    attachment_id,
                    attempt,
                    reason,
                )
                return AttachmentFetchResult(retryable=True, reason=reason)
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            reason = str(exc)
            if attempt == _MAX_ATTEMPTS:
                logger.warning(
                    "Attachment download failed for %s after %d attempts: %s",
                    attachment_id,
                    attempt,
                    reason,
                )
                return AttachmentFetchResult(retryable=True, reason=reason)

        time.sleep(0.5 * (2 ** (attempt - 1)))

    return AttachmentFetchResult(retryable=True, reason="attachment download failed")
