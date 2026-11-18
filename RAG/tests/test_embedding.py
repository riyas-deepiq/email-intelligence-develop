# tests/test_embedding.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from unittest.mock import MagicMock, patch


def mock_api_response(texts):
    """Return fake 768-dim embeddings for testing without Ollama."""
    return [[0.1] * 768 for _ in texts]


@patch("embedding.nomic_embedder.requests.post")
def test_embed_text_uses_document_prefix(mock_post):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"embeddings": [[0.1] * 768]}
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp

    from embedding.nomic_embedder import NomicEmbedder
    embedder = NomicEmbedder()
    embedder._ready = True  # skip warm-up

    vec = embedder.embed_text("test document")
    assert len(vec) == 768

    # Verify prefix was used
    call_args = mock_post.call_args
    payload = call_args[1]["json"] if "json" in call_args[1] else call_args[0][1]
    assert "search_document:" in str(payload.get("input", []))


@patch("embedding.nomic_embedder.requests.post")
def test_embed_query_uses_query_prefix(mock_post):
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"embeddings": [[0.2] * 768]}
    mock_resp.raise_for_status = MagicMock()
    mock_post.return_value = mock_resp

    from embedding.nomic_embedder import NomicEmbedder
    embedder = NomicEmbedder()
    embedder._ready = True

    vec = embedder.embed_query("what is the budget?")
    assert len(vec) == 768

    call_args = mock_post.call_args
    payload = call_args[1]["json"] if "json" in call_args[1] else call_args[0][1]
    assert "search_query:" in str(payload.get("input", []))


def test_chunker_splits_long_text():
    from ingestion.chunker import EmailChunker
    from ingestion.eml_parser import ParsedEmail

    chunker = EmailChunker()
    long_body = "This is a test sentence. " * 200  # ~5000 chars

    parsed = ParsedEmail(
        email_id="test_001",
        file_path="/tmp/test.eml",
        subject="Test",
        from_addr="alice@example.com",
        to_addrs="bob@example.com",
        date="2025-01-01",
        body_text=long_body,
    )

    chunks = chunker.chunk_email_body(parsed)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.email_id == "test_001"
        assert chunk.source_type == "body"
        assert len(chunk.text) > 0


def test_chunker_attachment():
    from ingestion.chunker import EmailChunker
    from ingestion.eml_parser import ParsedEmail

    chunker = EmailChunker()
    att_text = "Budget line item 1: $10,000\nBudget line item 2: $20,000\n" * 50

    parsed = ParsedEmail(
        email_id="test_002",
        file_path="/tmp/test2.eml",
        subject="Budget",
        from_addr="alice@example.com",
        date="2025-01-01",
    )
    chunks = chunker.chunk_attachment(att_text, parsed, "budget.xlsx")
    assert len(chunks) >= 1
    for chunk in chunks:
        assert chunk.source_type == "attachment"
        assert chunk.filename == "budget.xlsx"
