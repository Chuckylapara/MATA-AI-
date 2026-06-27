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
        import json

        import httpx

        system = "\n".join(m["content"] for m in messages if m["role"] == "system") or None
        contents = [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in messages
            if m["role"] != "system"
        ]
        body: dict = {"contents": contents, "generationConfig": {"temperature": temperature}}
        if system:
            body["system_instruction"] = {"parts": [{"text": system}]}

        model_name = model or settings.gemini_model
        url = (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model_name}:streamGenerateContent?alt=sse"
        )
        headers = {"x-goog-api-key": settings.gemini_api_key}

        yielded = False
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", url, headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        raise RuntimeError(f"stream status {resp.status_code}")
                    async for line in resp.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            obj = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        parts = obj.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                        for p in parts:
                            if p.get("text"):
                                yielded = True
                                yield p["text"]
            if yielded:
                return
        except Exception:
            if yielded:
                return  # partial stream already delivered; don't duplicate

        # Fallback: non-streaming with model-fallback chain, emitted word by word.
        from mata.common.gemini import gemini_generate

        text = await gemini_generate(contents=contents, system=system, model=model, temperature=temperature)
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
