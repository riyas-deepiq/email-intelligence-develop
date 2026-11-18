# =============================================================================
# ingestion/eml_parser.py — Parse .eml files into structured dataclasses
# =============================================================================
"""
EmlParser converts raw .eml files into ParsedEmail / ParsedAttachment objects
using the Python standard library's `email` module (primary) with mail-parser
as a fallback for complex MIME structures.

Key improvements over the previous flat-file version:
  - Returns typed dataclasses (not plain dicts)
  - Extracts raw attachment *bytes* separately so AttachmentParser can process
    each format with the best available library
  - Parses thread_id from In-Reply-To / References headers
  - Handles encoded-words (=?UTF-8?...?=) in headers correctly
"""
from __future__ import annotations

import email
import email.header
import email.policy
import gc
import hashlib
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger(__name__)


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class ParsedAttachment:
    filename: str
    content_type: str
    data: bytes                   # raw bytes — AttachmentParser processes these
    size_bytes: int = 0

    def __post_init__(self):
        self.size_bytes = len(self.data)


@dataclass
class ParsedEmail:
    email_id: str                 # filename stem (no .eml)
    file_path: str
    subject: str = ""
    from_addr: str = ""
    to_addrs: str = ""
    cc_addrs: str = ""
    date: str = ""
    thread_id: str = ""           # from In-Reply-To / References
    body_text: str = ""
    body_html: str = ""
    attachment_names: List[str] = field(default_factory=list)
    attachments: List[ParsedAttachment] = field(default_factory=list)
    raw_headers: dict = field(default_factory=dict)
    department: str = ""          # from mailboxes.department_name (Postgres source only)
    mailbox_id: str = ""          # messages.mailbox_id (Postgres source only)
    org_id: str = ""              # messages.org_id (Postgres source only)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decode_header(header_value: str) -> str:
    """Decode RFC 2047 encoded-word sequences in email headers."""
    if not header_value:
        return ""
    try:
        parts = email.header.decode_header(header_value)
        decoded_parts = []
        for part, charset in parts:
            if isinstance(part, bytes):
                decoded_parts.append(
                    part.decode(charset or "utf-8", errors="replace")
                )
            else:
                decoded_parts.append(str(part))
        return " ".join(decoded_parts).strip()
    except Exception:
        return str(header_value)


def _extract_addresses(raw: Optional[str]) -> str:
    """Return a normalised, comma-joined address string."""
    if not raw:
        return ""
    return raw.strip()[:500]


def _extract_thread_id(msg: email.message.Message) -> str:
    """Derive a thread identifier from In-Reply-To or References."""
    for hdr in ("In-Reply-To", "References"):
        val = msg.get(hdr, "")
        if val:
            # Take the first Message-ID found
            ids = re.findall(r"<[^>]+>", val)
            if ids:
                return ids[0]
    # Fall back to Message-ID itself (start of thread)
    msg_id = msg.get("Message-ID", "")
    if msg_id:
        ids = re.findall(r"<[^>]+>", msg_id)
        if ids:
            return ids[0]
    return ""


def _get_body_parts(msg: email.message.Message) -> tuple[str, str]:
    """
    Walk the MIME tree and return (plain_text, html_text).
    Prefers text/plain; collects text/html as fallback.
    """
    plain_parts: List[str] = []
    html_parts: List[str] = []

    for part in msg.walk():
        ct = part.get_content_type()
        disp = str(part.get("Content-Disposition", ""))

        if "attachment" in disp:
            continue

        charset = part.get_content_charset() or "utf-8"

        if ct == "text/plain":
            try:
                payload = part.get_payload(decode=True)
                if payload:
                    plain_parts.append(payload.decode(charset, errors="replace"))
            except Exception as exc:
                logger.debug("Could not decode text/plain part: %s", exc)

        elif ct == "text/html":
            try:
                payload = part.get_payload(decode=True)
                if payload:
                    html_parts.append(payload.decode(charset, errors="replace"))
            except Exception as exc:
                logger.debug("Could not decode text/html part: %s", exc)

    return "\n".join(plain_parts), "\n".join(html_parts)


def _extract_attachments(msg: email.message.Message) -> List[ParsedAttachment]:
    """Extract all attachment parts as ParsedAttachment objects."""
    attachments: List[ParsedAttachment] = []

    for part in msg.walk():
        disp = str(part.get("Content-Disposition", ""))
        filename = part.get_filename()

        # Include parts that have a filename (even if not marked as attachment)
        if not filename:
            continue

        filename = _decode_header(filename)
        ct = part.get_content_type()

        try:
            payload = part.get_payload(decode=True)
            if payload:
                attachments.append(
                    ParsedAttachment(
                        filename=filename,
                        content_type=ct,
                        data=payload,
                    )
                )
        except Exception as exc:
            logger.warning("Could not extract attachment '%s': %s", filename, exc)

    return attachments


# ── Parser class ──────────────────────────────────────────────────────────────

class EmlParser:
    """Parse .eml files into ParsedEmail dataclasses."""

    MAX_BODY_CHARS = 100_000

    def parse_file(self, file_path: str) -> Optional[ParsedEmail]:
        """
        Parse a single .eml file.  Returns None on failure.
        """
        path = Path(file_path)
        if not path.exists():
            logger.error("File not found: %s", file_path)
            return None

        try:
            raw = path.read_bytes()
        except OSError as exc:
            logger.error("Could not read %s: %s", file_path, exc)
            return None

        try:
            return self._parse_bytes(raw, file_path)
        except Exception as exc:
            logger.warning("Failed to parse %s: %s", file_path, exc)
            # Try mailparser as fallback
            return self._parse_with_mailparser(file_path)

    def _parse_bytes(self, raw: bytes, file_path: str) -> Optional[ParsedEmail]:
        """Primary parsing path using stdlib email module."""
        try:
            msg = email.message_from_bytes(raw, policy=email.policy.default)
        except Exception:
            msg = email.message_from_bytes(raw)

        email_id = Path(file_path).stem
        subject  = _decode_header(msg.get("Subject", ""))
        from_    = _decode_header(msg.get("From", ""))
        to_      = _decode_header(msg.get("To", ""))
        cc_      = _decode_header(msg.get("Cc", ""))
        date_    = _decode_header(msg.get("Date", ""))

        thread_id   = _extract_thread_id(msg)
        plain, html = _get_body_parts(msg)
        attachments = _extract_attachments(msg)

        # Trim body
        plain = plain[:self.MAX_BODY_CHARS]
        html  = html[:self.MAX_BODY_CHARS]

        parsed = ParsedEmail(
            email_id=email_id,
            file_path=file_path,
            subject=subject[:300],
            from_addr=from_[:200],
            to_addrs=to_[:500],
            cc_addrs=cc_[:500],
            date=date_,
            thread_id=thread_id,
            body_text=plain,
            body_html=html,
            attachment_names=[a.filename for a in attachments],
            attachments=attachments,
            raw_headers={k: v for k, v in msg.items()},
        )

        gc.collect()
        return parsed

    def _parse_with_mailparser(self, file_path: str) -> Optional[ParsedEmail]:
        """Fallback using mail-parser library."""
        try:
            import mailparser
            mail = mailparser.parse_from_file(file_path)
            email_id = Path(file_path).stem

            body_text = mail.body or ""
            attachments = []
            attachment_names = []

            for att in (mail.attachments or []):
                fname = att.get("filename", "")
                if fname:
                    attachment_names.append(fname)
                    # Try to get raw bytes from mailparser attachment
                    payload_raw = att.get("payload", "")
                    encoding = str(att.get("content_transfer_encoding", "")).lower()
                    try:
                        if encoding == "base64":
                            import base64
                            data = base64.b64decode(payload_raw)
                        elif isinstance(payload_raw, str):
                            data = payload_raw.encode("utf-8", errors="replace")
                        else:
                            data = bytes(payload_raw)
                        ct = att.get("mail_content_type", "application/octet-stream")
                        attachments.append(
                            ParsedAttachment(filename=fname, content_type=ct, data=data)
                        )
                    except Exception:
                        pass

            parsed = ParsedEmail(
                email_id=email_id,
                file_path=file_path,
                subject=str(mail.subject or "")[:300],
                from_addr=str(mail.from_ or "")[:200],
                to_addrs=str(mail.to or "")[:500],
                cc_addrs=str(mail.cc or "")[:500],
                date=str(mail.date or ""),
                thread_id="",
                body_text=body_text[:self.MAX_BODY_CHARS],
                attachment_names=attachment_names,
                attachments=attachments,
            )

            del mail
            gc.collect()
            return parsed

        except Exception as exc:
            logger.error("mailparser fallback also failed for %s: %s", file_path, exc)
            return None
