"""Shared structured-text LLM helper for the Studio orchestration brain.

Unlike the chat provider (which streams free text), the Studio brain needs a single
buffered call that returns *parsed JSON*. Provider preference mirrors the rest of the
platform: Anthropic (Claude) > Gemini > deterministic mock so it runs with no keys.

    data = await generate_json(system=..., prompt=..., temperature=0.8)

`generate_json` raises `LLMUnavailable` when no provider key is set, so callers can
fall back to their own deterministic mock (keeping the product usable offline).
"""
from __future__ import annotations

import json
import re

from mata.common.config import settings


class LLMUnavailable(RuntimeError):
    """Raised when no real LLM provider is configured."""


def llm_available() -> bool:
    return bool(settings.nvidia_api_key or settings.anthropic_api_key or settings.gemini_api_key)


def active_provider() -> str:
    if settings.nvidia_api_key:
        return "nvidia"
    if settings.anthropic_api_key:
        return "anthropic"
    if settings.gemini_api_key:
        return "gemini"
    return "mock"


_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json(text: str):
    """Best-effort parse of a JSON object/array out of an LLM response."""
    text = text.strip()
    # Strip a ```json ... ``` fence if present.
    m = _JSON_FENCE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Fall back to the first balanced {...} or [...] span.
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ValueError(f"Could not parse JSON from model output: {text[:200]}")


async def _anthropic_json(system: str, prompt: str, temperature: float, max_tokens: int) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    msg = await client.messages.create(
        model=settings.chat_model,
        max_tokens=max_tokens,
        temperature=temperature,
        system=system + "\n\nResponde ÚNICAMENTE con JSON válido, sin texto adicional ni explicaciones.",
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in msg.content if getattr(block, "type", None) == "text")


async def _nvidia_json(system: str, prompt: str, temperature: float, max_tokens: int) -> str:
    import httpx

    sys = system + "\n\nResponde ÚNICAMENTE con JSON válido, sin texto adicional ni explicaciones."
    payload = {
        "model": settings.nvidia_model,
        "messages": [{"role": "system", "content": sys}, {"role": "user", "content": prompt}],
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    headers = {"Authorization": f"Bearer {settings.nvidia_api_key}"}
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post("https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload)
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


async def _gemini_json(system: str, prompt: str, temperature: float) -> str:
    from mata.common.gemini import gemini_generate

    contents = [{"role": "user", "parts": [{"text": prompt}]}]
    sys = system + "\n\nResponde ÚNICAMENTE con JSON válido, sin texto adicional ni explicaciones."
    return await gemini_generate(contents=contents, system=sys, temperature=temperature)


async def generate_json(
    *,
    system: str,
    prompt: str,
    temperature: float = 0.8,
    max_tokens: int = 4096,
):
    """Return parsed JSON (dict or list) from the best available provider.

    Raises LLMUnavailable if no provider key is configured.
    """
    if settings.nvidia_api_key:
        try:
            raw = await _nvidia_json(system, prompt, temperature, max_tokens)
            return _extract_json(raw)
        except Exception:  # noqa: BLE001 — fall through to the next provider
            pass
    if settings.anthropic_api_key:
        raw = await _anthropic_json(system, prompt, temperature, max_tokens)
        return _extract_json(raw)
    if settings.gemini_api_key:
        raw = await _gemini_json(system, prompt, temperature)
        return _extract_json(raw)
    raise LLMUnavailable("No LLM provider configured (set NVIDIA_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY)")
