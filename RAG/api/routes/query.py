# =============================================================================
# api/routes/query.py — RAG query endpoints
# =============================================================================
from __future__ import annotations

import json
import logging
import re
import time
from typing import AsyncGenerator, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from api.internal_auth import require_internal_secret
from api.models import QueryRequest, QueryResponse, SourceChunk
from config import settings
from llm.ollama_client import get_llm_client
from llm.prompt_templates import SYSTEM_PROMPT, build_rag_prompt
from retrieval.context_builder import EmailContext
from retrieval.hybrid_search import HybridSearch
from retrieval.reranker import Reranker
from vector_store.qdrant_client import EmailQdrantClient

logger = logging.getLogger(__name__)
router = APIRouter(
    prefix="/api/v1/query",
    tags=["query"],
    dependencies=[Depends(require_internal_secret)],
)

# Module-level singletons (avoid repeated init overhead)
_hybrid_search: HybridSearch | None = None
_reranker:      Reranker | None     = None


def _get_search() -> HybridSearch:
    global _hybrid_search
    if _hybrid_search is None:
        _hybrid_search = HybridSearch()
    return _hybrid_search


def _get_reranker() -> Reranker:
    global _reranker
    if _reranker is None:
        _reranker = Reranker()
    return _reranker


# ── Greeting bypass ────────────────────────────────────────────────────────────
_GREETINGS = {"hi", "hello", "hey", "hi there", "hello there", "good morning",
              "good afternoon", "good evening", "howdy"}


def _is_greeting(query: str) -> bool:
    cleaned = re.sub(r"[^\w\s]", "", query.lower().strip())
    return cleaned in _GREETINGS


# ── Shared retrieval + rerank ──────────────────────────────────────────────────

def _retrieve(
    query: str,
    mailbox_ids: List[str],
    top_k: int,
    rerank_k: int,
    search_attachments: bool,
) -> List[EmailContext]:
    """
    Retrieve + rerank contexts for a query.

    ONE scoping mode, by design: mailbox_ids is the trusted, pre-resolved access
    scope from the Core Server (getScopedMailboxIds()/admin-check). RAG performs
    no identity lookup of its own — an empty list correctly means "see nothing",
    not "no filter" (see build_mailbox_filter).

    There used to be a fallback here: when mailbox_ids was omitted, RAG resolved
    scope itself from a caller-supplied user_id via search_with_rbac(). That
    made the entire hierarchy permission model bypassable by anyone who could
    reach this port — just omit mailbox_ids and pass whichever user_id you like.
    It is deliberately gone. Callers must state their scope explicitly, and the
    request model now requires it.
    """
    qdrant_filter = EmailQdrantClient.build_mailbox_filter(mailbox_ids)
    contexts = _get_search().search(
        query=query,
        top_k=top_k,
        qdrant_filter=qdrant_filter,
        search_attachments=search_attachments,
        score_threshold=settings.score_threshold,
    )

    try:
        return _get_reranker().rerank(query, contexts, top_k=rerank_k)
    except Exception as exc:
        logger.warning("Reranker failed: %s — using unranked results", exc)
        return contexts[:rerank_k]


def _to_source_chunks(contexts: List[EmailContext]) -> List[SourceChunk]:
    return [
        SourceChunk(
            email_id=c.email_id,
            thread_id=c.thread_id,
            subject=c.subject,
            from_addr=c.from_addr,
            date=c.date,
            source_type=c.source_type,
            filename=c.filename,
            score=round(c.score, 4),
            excerpt=c.chunk_text[:400],
        )
        for c in contexts
    ]


# ── POST /ask ─────────────────────────────────────────────────────────────────

@router.post("/ask", response_model=QueryResponse, summary="RAG query with LLM answer")
async def ask(body: QueryRequest):
    """
    Perform an access-scoped RAG query.

    1. Scope: the trusted mailbox_ids supplied by the Core Server (required).
    2. Run HybridSearch over both Qdrant collections.
    3. Cross-encoder rerank.
    4. Build prompt → generate answer via Ollama.
    5. Return answer + source citations.
    """
    t0 = time.perf_counter()

    if _is_greeting(body.query):
        return QueryResponse(
            answer="Hello! I'm your Insight Hub Assistant. Ask me anything about your emails.",
            chunks=[],
            user_id=body.user_id,
            query=body.query,
            elapsed_ms=0,
        )

    try:
        contexts = _retrieve(
            body.query, body.mailbox_ids,
            body.top_k, body.rerank_k, body.search_attachments,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Retrieval failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Retrieval error: {exc}")

    source_chunks = _to_source_chunks(contexts)

    try:
        prompt = build_rag_prompt(body.query, contexts)
        llm    = get_llm_client()
        answer = llm.generate(prompt, system=SYSTEM_PROMPT, temperature=body.temperature)
    except Exception as exc:
        logger.error("LLM generation failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Generation error: {exc}")

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return QueryResponse(
        answer=answer,
        chunks=source_chunks,
        user_id=body.user_id,
        query=body.query,
        elapsed_ms=elapsed_ms,
    )


# ── POST /search (semantic search only, no LLM) ───────────────────────────────

@router.post("/search", summary="Semantic search (no LLM)")
async def search(body: QueryRequest):
    """Return ranked source chunks without LLM generation."""
    contexts = _retrieve(
        body.query, body.mailbox_ids,
        body.top_k, body.rerank_k, body.search_attachments,
    )
    return {
        "chunks": [c.model_dump() for c in _to_source_chunks(contexts)],
        "total": len(contexts),
    }


# ── POST /stream (SSE streaming answer) ───────────────────────────────────────

@router.post("/stream", summary="Streaming answer via SSE")
async def stream_answer(body: QueryRequest):
    """
    Stream the LLM answer token-by-token as Server-Sent Events, followed by one
    final event carrying the full answer + source citations (so callers don't
    have to reconstruct the answer by concatenating tokens themselves), then
    [DONE].

    Event shapes:
      data: {"chunk": "<token>"}\n\n            — zero or more
      data: {"final": {"answer": ..., "chunks": [...]}}\n\n  — exactly one
      data: [DONE]\n\n
    """
    if _is_greeting(body.query):
        async def _greeting_generator() -> AsyncGenerator[str, None]:
            answer = "Hello! I'm your Insight Hub Assistant. Ask me anything about your emails."
            yield f"data: {json.dumps({'chunk': answer})}\n\n"
            yield f"data: {json.dumps({'final': {'answer': answer, 'chunks': []}})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_greeting_generator(), media_type="text/event-stream")

    try:
        contexts = _retrieve(
            body.query, body.mailbox_ids,
            body.top_k, body.rerank_k, body.search_attachments,
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Retrieval failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Retrieval error: {exc}")

    source_chunks = _to_source_chunks(contexts)
    prompt = build_rag_prompt(body.query, contexts)
    llm    = get_llm_client()

    async def _event_generator() -> AsyncGenerator[str, None]:
        accumulated = ""
        for token in llm.stream(prompt, system=SYSTEM_PROMPT, temperature=body.temperature):
            accumulated += token
            yield f"data: {json.dumps({'chunk': token})}\n\n"
        final = {"answer": accumulated, "chunks": [c.model_dump() for c in source_chunks]}
        yield f"data: {json.dumps({'final': final})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(_event_generator(), media_type="text/event-stream")
