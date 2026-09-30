"""Anthropic Claude provider (Messages API)."""
from __future__ import annotations

from collections.abc import AsyncIterator

from mata.common.config import settings
from mata.nexus.providers.base import ChatResult, ModelProvider, ProviderError, as_dicts


class AnthropicProvider(ModelProvider):
    name = "anthropic"
    capabilities = {"chat", "stream", "vision", "json", "tools"}

    def __init__(self, api_key: str, model: str | None = None) -> None:
        from anthropic import AsyncAnthropic

        self._client = AsyncAnthropic(api_key=api_key)
        self.model = model or settings.chat_model

    def model_for(self, role: str) -> str:
        return self.model

    async def chat(self, messages, *, system: str = "", temperature: float = 0.6, max_tokens: int = 1024,
                   role: str = "reasoning") -> ChatResult:
        kwargs = dict(model=self.model, max_tokens=max_tokens, temperature=temperature, messages=as_dicts(messages))
        if system:
            kwargs["system"] = system
        try:
            msg = await self._client.messages.create(**kwargs)
        except Exception as exc:  # noqa: BLE001 — SDK raises many types
            raise ProviderError(f"anthropic: {exc}") from exc
        text = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text")
        usage = {"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens}
        return ChatResult(text=text, provider=self.name, model=self.model, usage=usage)

    async def stream(self, messages, *, system: str = "", temperature: float = 0.6, max_tokens: int = 1024,
                     role: str = "reasoning") -> AsyncIterator[str]:
        kwargs = dict(model=self.model, max_tokens=max_tokens, temperature=temperature, messages=as_dicts(messages))
        if system:
            kwargs["system"] = system
        try:
            async with self._client.messages.stream(**kwargs) as s:
                async for text in s.text_stream:
                    yield text
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"anthropic: {exc}") from exc

    async def vision(self, prompt: str, image_b64: str, mime: str = "image/jpeg") -> ChatResult:
        content = [
            {"type": "image", "source": {"type": "base64", "media_type": mime, "data": image_b64}},
            {"type": "text", "text": prompt},
        ]
        return await self.chat([{"role": "user", "content": content}], max_tokens=700, temperature=0.2)
