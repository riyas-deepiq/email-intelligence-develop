# =============================================================================
# retrieval/context_builder.py — EmailContext dataclass + prompt builder
# =============================================================================
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional


@dataclass
class EmailContext:
    """A single retrieved chunk ready for LLM prompt construction."""
    chunk_text:  str
    subject:     str
    from_addr:   str
    date:        str
    source_type: str          # "body" | "attachment"
    email_id:    str = ""
    thread_id:   str = ""
    filename:    str = ""     # populated for attachment chunks
    page_num:    Optional[int] = None
    score:       float = 0.0

    @classmethod
    def from_scored_point(cls, point) -> "EmailContext":
        """Construct from a Qdrant ScoredPoint."""
        p = point.payload or {}
        return cls(
            chunk_text=p.get("chunk_text", ""),
            subject=p.get("subject", "N/A"),
            from_addr=p.get("from_addr", p.get("sender", "N/A")),
            date=p.get("date", "N/A"),
            source_type=p.get("source_type", "body"),
            email_id=p.get("email_id", ""),
            thread_id=p.get("thread_id", ""),
            filename=p.get("filename", ""),
            page_num=p.get("page_num"),
            score=float(point.score),
        )


# ── Prompt builder ─────────────────────────────────────────────────────────────

def build_rag_prompt(
    query: str,
    contexts: List[EmailContext],
    max_chars: int = 6000,
) -> str:
    """
    Assemble a structured RAG prompt from retrieved contexts.

    Format:
        ═══ EMAIL CONTEXT ═══
        [Source 1] Email Body
        Subject : ...
        From    : ...
        Date    : ...
        Content : ...
        ───────────────────
        ...
        ═══════════════════
        Question: ...
    """
    separator = "─" * 50
    top_sep   = "═" * 50

    sections: List[str] = [top_sep, "EMAIL CONTEXT", top_sep]
    total_chars = 0

    for i, ctx in enumerate(contexts, 1):
        label = f"[Source {i}] "
        if ctx.source_type == "attachment" and ctx.filename:
            label += f"Attachment: {ctx.filename}"
            if ctx.page_num is not None:
                label += f" (page {ctx.page_num})"
        else:
            label += "Email Body"

        content_preview = ctx.chunk_text
        remaining = max_chars - total_chars
        if len(content_preview) > remaining:
            content_preview = content_preview[:remaining] + "…"
            total_chars = max_chars
        else:
            total_chars += len(content_preview)

        block = (
            f"{label}\n"
            f"Subject : {ctx.subject}\n"
            f"From    : {ctx.from_addr}\n"
            f"Date    : {ctx.date}\n"
            f"Content : {content_preview}"
        )
        sections.append(block)
        sections.append(separator)

        if total_chars >= max_chars:
            break

    sections.append(top_sep)
    sections.append(f"Question: {query}")

    return "\n".join(sections)


def build_summary_prompt(contexts: List[EmailContext]) -> str:
    """Build a prompt asking the LLM to summarise the given contexts."""
    return build_rag_prompt(
        query="Please summarise the key information from these email excerpts.",
        contexts=contexts,
    )
