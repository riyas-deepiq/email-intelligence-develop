# =============================================================================
# ingestion/chunker.py — LangChain-based text chunking with tiktoken
# =============================================================================
"""
EmailChunker splits email bodies and attachment text into fixed-size overlapping
chunks suitable for embedding with nomic-embed-text (8192 token context window).

Chunk size: 400 tokens  (~1600 chars)
Overlap:    50 tokens   (ensures cross-chunk context)

Each TextChunk carries all metadata needed for Qdrant payload construction.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger(__name__)

# ── Lazy imports for heavy libraries ─────────────────────────────────────────
# split_text() itself is a stateless read-only operation on the splitter's
# config, safe to call concurrently once constructed — the lock only guards
# first-time construction, since concurrent ingestion (IngestionPipeline's
# max_workers) can call _get_splitter() from several worker threads at once.
_splitter = None
_enc = None
_splitter_lock = threading.Lock()


def _get_splitter():
    global _splitter
    if _splitter is None:
        with _splitter_lock:
            if _splitter is None:
                try:
                    from langchain_text_splitters import RecursiveCharacterTextSplitter
                    from config import settings
                    _splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
                        encoding_name="cl100k_base",
                        chunk_size=settings.chunk_size,
                        chunk_overlap=settings.chunk_overlap,
                        separators=["\n\n", "\n", ". ", " ", ""],
                    )
                except Exception as exc:
                    logger.warning(
                        "Could not load tiktoken splitter (%s) — using char splitter", exc
                    )
                    from langchain_text_splitters import RecursiveCharacterTextSplitter
                    from config import settings
                    _splitter = RecursiveCharacterTextSplitter(
                        chunk_size=settings.chunk_size * 4,   # approx 4 chars per token
                        chunk_overlap=settings.chunk_overlap * 4,
                        separators=["\n\n", "\n", ". ", " ", ""],
                    )
    return _splitter


def _token_len(text: str) -> int:
    """Estimate token count using tiktoken cl100k_base."""
    try:
        import tiktoken
        enc = tiktoken.get_encoding("cl100k_base")
        return len(enc.encode(text))
    except Exception:
        return len(text) // 4  # rough fallback


# ── TextChunk dataclass ───────────────────────────────────────────────────────

@dataclass
class TextChunk:
    # Content
    text: str
    token_count: int = 0

    # Email metadata
    email_id: str = ""
    subject: str = ""
    from_addr: str = ""
    to_addrs: str = ""
    cc_addrs: str = ""
    date: str = ""
    thread_id: str = ""

    # Chunk metadata
    chunk_index: int = 0
    source_type: str = "body"      # "body" | "attachment"

    # Attachment-specific
    filename: str = ""
    page_num: Optional[int] = None
    # Postgres `attachments.id` (Postgres-sourced attachments only) — lets
    # EmailQdrantClient.delete_attachment() re-run ingestion idempotently,
    # same role email_id plays for delete_email().
    attachment_id: str = ""

    # RBAC helpers (extracted email addresses)
    rbac_sender: List[str] = field(default_factory=list)
    rbac_to: List[str] = field(default_factory=list)
    rbac_cc: List[str] = field(default_factory=list)
    department: str = "Unknown"

    # Real access-control scope (Postgres source only) — the Core Server's own
    # org-hierarchy mailbox scoping (getScopedMailboxIds) is the actual RBAC
    # primitive the rest of the app uses, so this is what queries filter on.
    mailbox_id: str = ""
    org_id: str = ""

    def __post_init__(self):
        if not self.token_count:
            self.token_count = _token_len(self.text)


# ── EmailChunker ─────────────────────────────────────────────────────────────

class EmailChunker:
    """Splits parsed email content into embedding-ready TextChunks."""

    # Inject header context into every chunk so the model knows the source
    ENRICH_TEMPLATE = (
        "Subject: {subject}\n"
        "From: {from_addr}\n"
        "Date: {date}\n\n"
        "{chunk_text}"
    )

    def chunk_email_body(self, parsed_email) -> List[TextChunk]:
        """
        Chunk the plain-text body of a ParsedEmail.

        Args:
            parsed_email: ParsedEmail dataclass instance.

        Returns:
            List of TextChunk objects ready for embedding.
        """
        body = (parsed_email.body_text or "").strip()

        # If no plain text, try stripping HTML tags from body_html
        if not body and parsed_email.body_html:
            body = self._strip_html(parsed_email.body_html)

        if not body:
            logger.debug("No body text for email %s", parsed_email.email_id)
            return []

        splitter = _get_splitter()
        raw_chunks = splitter.split_text(body)

        chunks: List[TextChunk] = []
        for i, raw in enumerate(raw_chunks):
            enriched = self.ENRICH_TEMPLATE.format(
                subject=parsed_email.subject,
                from_addr=parsed_email.from_addr,
                date=parsed_email.date,
                chunk_text=raw,
            )
            chunks.append(
                TextChunk(
                    text=enriched,
                    email_id=parsed_email.email_id,
                    subject=parsed_email.subject,
                    from_addr=parsed_email.from_addr,
                    to_addrs=parsed_email.to_addrs,
                    cc_addrs=parsed_email.cc_addrs,
                    date=parsed_email.date,
                    thread_id=parsed_email.thread_id,
                    chunk_index=i,
                    source_type="body",
                    department=getattr(parsed_email, "department", "") or "Unknown",
                    mailbox_id=getattr(parsed_email, "mailbox_id", ""),
                    org_id=getattr(parsed_email, "org_id", ""),
                )
            )

        logger.debug(
            "Chunked email %s body into %d chunks", parsed_email.email_id, len(chunks)
        )
        return chunks

    def chunk_attachment(
        self,
        text: str,
        parsed_email,
        filename: str,
        attachment_id: str = "",
    ) -> List[TextChunk]:
        """
        Chunk extracted attachment text.

        Args:
            text:          Extracted text from the attachment.
            parsed_email:  Parent ParsedEmail (for metadata).
            filename:      Attachment filename.
            attachment_id: Postgres `attachments.id`, if sourced from Postgres.

        Returns:
            List of TextChunk objects with source_type="attachment".
        """
        text = text.strip()
        if not text:
            return []

        splitter = _get_splitter()
        raw_chunks = splitter.split_text(text)

        chunks: List[TextChunk] = []
        for i, raw in enumerate(raw_chunks):
            enriched = (
                f"Subject: {parsed_email.subject}\n"
                f"From: {parsed_email.from_addr}\n"
                f"Date: {parsed_email.date}\n"
                f"Attachment: {filename}\n\n"
                f"{raw}"
            )
            chunks.append(
                TextChunk(
                    text=enriched,
                    email_id=parsed_email.email_id,
                    subject=parsed_email.subject,
                    from_addr=parsed_email.from_addr,
                    to_addrs=parsed_email.to_addrs,
                    cc_addrs=parsed_email.cc_addrs,
                    date=parsed_email.date,
                    thread_id=parsed_email.thread_id,
                    chunk_index=i,
                    source_type="attachment",
                    filename=filename,
                    attachment_id=attachment_id,
                    department=getattr(parsed_email, "department", "") or "Unknown",
                    mailbox_id=getattr(parsed_email, "mailbox_id", ""),
                    org_id=getattr(parsed_email, "org_id", ""),
                )
            )

        logger.debug(
            "Chunked attachment '%s' into %d chunks", filename, len(chunks)
        )
        return chunks

    @staticmethod
    def _strip_html(html: str) -> str:
        """Very simple HTML tag stripping without BeautifulSoup dependency."""
        import re
        # Remove script/style blocks
        html = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.DOTALL | re.IGNORECASE)
        # Remove tags
        html = re.sub(r"<[^>]+>", " ", html)
        # Decode common entities
        html = html.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        # Collapse whitespace
        html = re.sub(r"\s+", " ", html)
        return html.strip()
