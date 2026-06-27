"""Chat provider adapters. Real (Anthropic) when a key is set, else deterministic mock.

Adapter contract:
    async def stream(messages, model, temperature) -> AsyncIterator[str]   # yields text deltas
    returns total token estimate via the final usage tuple from `complete`.
"""
from __future__ import annotations

from collections.abc import AsyncIterator

from mata.common.config import settings


def _estimate_tokens(text: str) -> int:
    # ~4 chars/token heuristic; replaced by real provider usage when available.
    return max(1, len(text) // 4)


class MockChatProvider:
    name = "mock"

    async def stream(self, messages, model, temperature) -> AsyncIterator[str]:
        last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
        reply = (
            f"[Mata AI · mock model] You said: \"{last_user[:160]}\". "
            "This is a deterministic offline response. Set ANTHROPIC_API_KEY to use the live model."
        )
        for word in reply.split(" "):
            yield word + " "


class AnthropicChatProvider:
    name = "anthropic"

    def __init__(self) -> None:
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)

    async def stream(self, messages, model, temperature) -> AsyncIterator[str]:
        system = "\n".join(m["content"] for m in messages if m["role"] == "system") or None
        convo = [{"role": m["role"], "content": m["content"]} for m in messages if m["role"] != "system"]
        async with self._client.messages.stream(
            model=model or settings.chat_model,
            max_tokens=2048,
            temperature=temperature,
            system=system,
            messages=convo,
        ) as stream:
            async for text in stream.text_stream:
                yield text


class GeminiChatProvider:
    name = "gemini"

    async def stream(self, messages, model, temperature) -> AsyncIterator[str]:
        from mata.common.gemini import gemini_generate

        system = "\n".join(m["content"] for m in messages if m["role"] == "system") or None
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
            if m["role"] != "system"
        ]
        text = await gemini_generate(contents=contents, system=system, model=model, temperature=temperature)
        # Emit in word chunks so the UI still streams.
        for word in text.split(" "):
            yield word + " "


def get_chat_provider():
    if settings.anthropic_api_key:
        return AnthropicChatProvider()
    if settings.gemini_api_key:
        return GeminiChatProvider()
    return MockChatProvider()


def estimate_tokens(text: str) -> int:
    return _estimate_tokens(text)
