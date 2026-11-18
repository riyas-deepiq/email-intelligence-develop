# =============================================================================
# llm/ollama_client.py — Ollama LLM client (generate + stream)
# =============================================================================
"""
OllamaLLMClient communicates with the locally running Ollama instance via HTTP.
Supports both blocking generation and token streaming.

Model configuration:
  DEV  : gemma4-e4b-custom:latest  (fast, fits low VRAM)
  PROD : mistral:7b  (higher quality, needs 8GB+ RAM)
"""
from __future__ import annotations

import json
import logging
from typing import Generator, List, Optional

import requests

from config import settings

logger = logging.getLogger(__name__)

_GENERATE_URL = f"{settings.ollama_base_url}/api/generate"
_CHAT_URL     = f"{settings.ollama_base_url}/api/chat"


class OllamaLLMClient:
    """
    Thin HTTP wrapper around Ollama's /api/generate endpoint.

    Usage:
        client = OllamaLLMClient()
        answer = client.generate(prompt, system=SYSTEM_PROMPT)

        # Streaming:
        for token in client.stream(prompt):
            print(token, end="", flush=True)
    """

    def __init__(
        self,
        model:       Optional[str] = None,
        temperature: float = 0.1,
        max_tokens:  int   = 1024,
        base_url:    Optional[str] = None,
        timeout:     Optional[int] = None,
    ):
        self.model       = model    or settings.ollama_model
        self.temperature = temperature
        self.max_tokens  = max_tokens
        self.base_url    = base_url or settings.ollama_base_url
        self.timeout     = timeout  or settings.ollama_timeout
        self._gen_url    = f"{self.base_url}/api/generate"

    # ── Public API ─────────────────────────────────────────────────────────────

    def generate(
        self,
        prompt:      str,
        system:      Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens:  Optional[int]   = None,
        stream:      bool = False,
    ) -> str:
        """
        Generate a complete response (blocking).

        Args:
            prompt:      The user / context prompt.
            system:      Optional system instruction (prepended to prompt).
            temperature: Override default temperature.
            max_tokens:  Override default max_tokens.
            stream:      If True, internally streams but returns full text.

        Returns:
            Generated text as a single string.
        """
        if stream:
            return "".join(self._stream(prompt, system, temperature, max_tokens))
        return self._generate(prompt, system, temperature, max_tokens)

    def stream(
        self,
        prompt:      str,
        system:      Optional[str]   = None,
        temperature: Optional[float] = None,
        max_tokens:  Optional[int]   = None,
    ) -> Generator[str, None, None]:
        """Yield tokens one by one as they arrive from Ollama."""
        yield from self._stream(prompt, system, temperature, max_tokens)

    def check_model(self) -> bool:
        """Return True if the model is available in Ollama."""
        try:
            r = requests.get(f"{self.base_url}/api/tags", timeout=5)
            models = [m["name"] for m in r.json().get("models", [])]
            return any(self.model in m for m in models)
        except Exception:
            return False

    def warm_up(self) -> None:
        """Pre-load the model into Ollama memory."""
        logger.info("Warming up LLM model: %s", self.model)
        try:
            # Pull
            requests.post(
                f"{self.base_url}/api/pull",
                json={"name": self.model, "stream": False},
                timeout=self.timeout,
            )
            # Warm ping
            requests.post(
                self._gen_url,
                json={"model": self.model, "prompt": "", "stream": False},
                timeout=self.timeout,
            )
            logger.info("✅ LLM model ready: %s", self.model)
        except Exception as exc:
            logger.warning("LLM warm-up failed: %s", exc)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _make_payload(
        self,
        prompt:      str,
        system:      Optional[str],
        temperature: Optional[float],
        max_tokens:  Optional[int],
        stream:      bool,
    ) -> dict:
        full_prompt = prompt
        if system:
            full_prompt = f"{system}\n\n{prompt}"
        return {
            "model":  self.model,
            "prompt": full_prompt,
            "stream": stream,
            "options": {
                "temperature": temperature or self.temperature,
                "num_predict": max_tokens or self.max_tokens,
                "num_ctx":     8192,
                "top_p":       0.9,
                "num_thread":  8,
            },
        }

    def _generate(
        self,
        prompt:      str,
        system:      Optional[str],
        temperature: Optional[float],
        max_tokens:  Optional[int],
    ) -> str:
        payload = self._make_payload(prompt, system, temperature, max_tokens, stream=True)
        response = requests.post(
            self._gen_url, json=payload, timeout=self.timeout, stream=True
        )
        response.raise_for_status()

        parts: List[str] = []
        for line in response.iter_lines():
            if not line:
                continue
            try:
                chunk = json.loads(line)
                parts.append(chunk.get("response", ""))
                if chunk.get("done", False):
                    break
            except json.JSONDecodeError:
                continue

        answer = "".join(parts).strip()
        logger.info("LLM generation complete (%d chars)", len(answer))
        return answer

    def _stream(
        self,
        prompt:      str,
        system:      Optional[str],
        temperature: Optional[float],
        max_tokens:  Optional[int],
    ) -> Generator[str, None, None]:
        payload = self._make_payload(prompt, system, temperature, max_tokens, stream=True)
        response = requests.post(
            self._gen_url, json=payload, timeout=self.timeout, stream=True
        )
        response.raise_for_status()

        for line in response.iter_lines(decode_unicode=True):
            if not line:
                continue
            try:
                chunk = json.loads(line)
                token = chunk.get("response", "")
                if token:
                    yield token
                if chunk.get("done", False):
                    break
            except json.JSONDecodeError:
                continue


# ── Module-level singleton ────────────────────────────────────────────────────
_llm_client: Optional[OllamaLLMClient] = None


def get_llm_client() -> OllamaLLMClient:
    """Return shared OllamaLLMClient singleton."""
    global _llm_client
    if _llm_client is None:
        _llm_client = OllamaLLMClient()
    return _llm_client
