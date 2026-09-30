"""Google Gemini provider (REST)."""
from __future__ import annotations

import httpx

from mata.common.config import settings
from mata.nexus.providers.base import ChatResult, ModelProvider, ProviderError, as_dicts

_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GeminiProvider(ModelProvider):
    name = "gemini"
    capabilities = {"chat", "stream", "vision", "embeddings", "json"}

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.model = settings.gemini_model
        self.embed_model = settings.gemini_embed_model

    def model_for(self, role: str) -> str:
        return self.embed_model if role == "embeddings" else self.model

    async def _generate(self, contents: list[dict], system: str, temperature: float, max_tokens: int) -> str:
        body: dict = {"contents": contents,
                      "generationConfig": {"temperature": temperature, "maxOutputTokens": max_tokens}}
        if system:
            body["system_instruction"] = {"parts": [{"text": system}]}
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(f"{_BASE}/{self.model}:generateContent",
                                         headers={"x-goog-api-key": self.api_key}, json=body)
        except httpx.HTTPError as exc:
            raise ProviderError(f"gemini: network error: {exc}") from exc
        if resp.status_code != 200:
            raise ProviderError(f"gemini: HTTP {resp.status_code}: {resp.text[:200]}")
        parts = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)

    async def chat(self, messages, *, system: str = "", temperature: float = 0.6, max_tokens: int = 1024,
                   role: str = "reasoning") -> ChatResult:
        contents = [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
                    for m in as_dicts(messages)]
        text = await self._generate(contents, system, temperature, max_tokens)
        return ChatResult(text=text, provider=self.name, model=self.model)

    async def vision(self, prompt: str, image_b64: str, mime: str = "image/jpeg") -> ChatResult:
        contents = [{"role": "user", "parts": [{"inline_data": {"mime_type": mime, "data": image_b64}},
                                               {"text": prompt}]}]
        text = await self._generate(contents, "", 0.2, 700)
        return ChatResult(text=text, provider=self.name, model=self.model)

    async def embeddings(self, texts: list[str]) -> list[list[float]]:
        reqs = [{"model": f"models/{self.embed_model}", "content": {"parts": [{"text": t}]}} for t in texts]
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(f"{_BASE}/{self.embed_model}:batchEmbedContents",
                                         headers={"x-goog-api-key": self.api_key}, json={"requests": reqs})
        except httpx.HTTPError as exc:
            raise ProviderError(f"gemini: network error: {exc}") from exc
        if resp.status_code != 200:
            raise ProviderError(f"gemini: HTTP {resp.status_code}: {resp.text[:200]}")
        return [e["values"] for e in resp.json()["embeddings"]]
