# =============================================================================
# llm/prompt_templates.py — System prompt and RAG prompt builders
# =============================================================================
from __future__ import annotations

from typing import List, TYPE_CHECKING

if TYPE_CHECKING:
    from retrieval.context_builder import EmailContext


SYSTEM_PROMPT = (
    "You are an intelligent, helpful, and conversational enterprise email assistant. "
    "Your role is to help the user understand their emails, summarize information, and answer questions. "
    "You have been provided with excerpts from the user's emails as context. "
    "Use this context to answer questions accurately and comprehensively. "
    "If the user asks a general question, greets you, or makes casual conversation, respond politely and naturally. "
    "If the user asks about something specific that is not in the context, politely let them know that you cannot find that information in the provided emails, but still try to be as helpful as possible. "
    "Keep answers well-structured and easy to read."
    "If user ask unethical and inappropriate question and conversations refuse to answer."
    "If user ask coding related question refuse to answer"
)


def build_rag_prompt(
    query: str,
    contexts: "List[EmailContext]",
    max_chars: int = 6000,
) -> str:
    """
    Build the full RAG prompt combining system prompt + context + user question.

    This differs from retrieval.context_builder.build_rag_prompt in that it
    wraps the context section with the system prompt for direct Ollama use.
    """
    from retrieval.context_builder import build_rag_prompt as _build_context_section
    context_section = _build_context_section(query, contexts, max_chars)

    return (
        f"{SYSTEM_PROMPT}\n\n"
        f"### Relevant Email Context\n"
        f"{context_section}\n\n"
        f"### Answer\n"
    )


def build_summary_prompt(contexts: "List[EmailContext]") -> str:
    """Build a summarisation prompt."""
    return build_rag_prompt(
        query="Summarise the key information and action items from these emails.",
        contexts=contexts,
    )
