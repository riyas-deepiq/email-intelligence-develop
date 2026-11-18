# tests/test_retrieval.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from unittest.mock import MagicMock, patch

from retrieval.context_builder import EmailContext, build_rag_prompt


def make_context(subject="Test", score=0.8, source_type="body", filename=""):
    return EmailContext(
        chunk_text="This is a test email body about project updates.",
        subject=subject,
        from_addr="alice@example.com",
        date="2025-01-01",
        source_type=source_type,
        email_id="email_001",
        filename=filename,
        score=score,
    )


def test_build_rag_prompt_contains_query():
    ctx = make_context()
    prompt = build_rag_prompt("What is the project status?", [ctx])
    assert "What is the project status?" in prompt


def test_build_rag_prompt_contains_source():
    ctx = make_context(subject="Q4 Budget Review")
    prompt = build_rag_prompt("budget?", [ctx])
    assert "Q4 Budget Review" in prompt
    assert "alice@example.com" in prompt


def test_build_rag_prompt_attachment_label():
    ctx = make_context(source_type="attachment", filename="report.pdf")
    prompt = build_rag_prompt("report?", [ctx])
    assert "report.pdf" in prompt


def test_build_rag_prompt_multiple_sources():
    contexts = [make_context(f"Email {i}", score=0.9 - i * 0.1) for i in range(5)]
    prompt = build_rag_prompt("test query", contexts)
    assert "[Source 1]" in prompt
    assert "[Source 5]" in prompt


def test_email_context_from_scored_point():
    point = MagicMock()
    point.payload = {
        "chunk_text":  "Hello this is an email",
        "subject":     "Meeting Notes",
        "from_addr":   "bob@example.com",
        "date":        "2025-06-01",
        "source_type": "body",
        "email_id":    "mtg_001",
    }
    point.score = 0.75

    ctx = EmailContext.from_scored_point(point)
    assert ctx.subject    == "Meeting Notes"
    assert ctx.from_addr  == "bob@example.com"
    assert ctx.score      == 0.75
    assert ctx.source_type == "body"


def test_reranker_fallback_on_no_model():
    """Reranker should fall back to score-based ordering if model unavailable."""
    import retrieval.reranker as _r
    _r._model_failed = True  # force fallback mode

    from retrieval.reranker import Reranker
    reranker = Reranker()

    contexts = [make_context(f"Email {i}", score=float(i) / 10) for i in range(10)]
    ranked = reranker.rerank("test", contexts, top_k=3)

    assert len(ranked) == 3
    # Should be sorted descending by score
    scores = [c.score for c in ranked]
    assert scores == sorted(scores, reverse=True)

    _r._model_failed = False  # restore
