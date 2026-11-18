# llm/__init__.py
from llm.ollama_client import OllamaLLMClient, get_llm_client
from llm.prompt_templates import SYSTEM_PROMPT, build_rag_prompt, build_summary_prompt

__all__ = [
    "OllamaLLMClient",
    "get_llm_client",
    "SYSTEM_PROMPT",
    "build_rag_prompt",
    "build_summary_prompt",
]
