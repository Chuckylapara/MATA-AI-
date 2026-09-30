"""One provider class for every OpenAI-compatible API: OpenAI, NVIDIA NIM, Groq, Ollama."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from mata.nexus.providers.base import ChatMessage, ChatResult, ModelProvider, ProviderError, as_dicts


class OpenAICompatibleProvider(ModelProvider):
    def __init__(
        self, *, name: str, base_url: str, api_key: str | None, chat_model: str,
        fast_model: str | None = None, vision_model: str | None = None, embed_model: str | None = None,
        local: bool = False, timeout: float = 90.0, alt_models: list[str] | None = None,
    ) -> None:
        self.name = name
        #: tried in order when the configured model is unknown/retired (HTTP 400/404/410/422)
        self.alt_models = alt_models or []
        self._working: dict[str, str] = {}
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.chat_model = chat_model
        self.fast_model = fast_model or chat_model
        self.vision_model = vision_model
        self.embed_model = embed_model
        self.local = local
        self.timeout = timeout
        caps = {"chat", "stream", "json"}
        if vision_model:
            caps.add("vision")
        if embed_model:
            caps.add("embeddings")
        self.capabilities = caps

    def model_for(self, role: str) -> str:
        return {"fast": self.fast_model, "vision": self.vision_model or self.chat_model,
                "embeddings": self.embed_model or ""}.get(role, self.chat_model)

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    def _payload(self, messages, system, temperature, max_tokens, role, stream=False) -> dict:
        msgs = ([{"role": "system", "content": system}] if system else []) + as_dicts(messages)
        return {"model": self.model_for(role), "messages": msgs, "temperature": temperature,
                "max_tokens": max_tokens, "stream": stream}

    def _candidates(self, role: str) -> list[str]:
        first = self._working.get(role) or self.model_for(role)
        return [first, *(m for m in [self.model_for(role), *self.alt_models] if m != first)]

    @staticmethod
    def _model_problem(status: int, body: str) -> bool:
        return status in (404, 410) or (status in (400, 422) and "model" in body.lower())

    async def chat(self, messages: list[ChatMessage] | list[dict], *, system: str = "", temperature: float = 0.6,
                   max_tokens: int = 1024, role: str = "reasoning") -> ChatResult:
        payload = self._payload(messages, system, temperature, max_tokens, role)
        candidates = self._candidates(role)
        for i, model in enumerate(candidates):
            payload["model"] = model
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=payload)
            except httpx.HTTPError as exc:
                raise ProviderError(f"{self.name}: network error: {exc}") from exc
            if resp.status_code != 200:
                if self._model_problem(resp.status_code, resp.text) and i + 1 < len(candidates):
                    continue
                raise ProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            try:
                text = data["choices"][0]["message"]["content"] or ""
            except (KeyError, IndexError) as exc:
                raise ProviderError(f"{self.name}: unexpected response shape") from exc
            self._working[role] = model
            return ChatResult(text=text, provider=self.name, model=model, usage=data.get("usage") or {})
        raise ProviderError(f"{self.name}: no usable model")

    async def stream(self, messages, *, system: str = "", temperature: float = 0.6, max_tokens: int = 1024,
                     role: str = "reasoning") -> AsyncIterator[str]:
        payload = self._payload(messages, system, temperature, max_tokens, role, stream=True)
        candidates = self._candidates(role)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                for i, model in enumerate(candidates):
                    payload["model"] = model
                    async with client.stream("POST", f"{self.base_url}/chat/completions",
                                             headers=self._headers(), json=payload) as resp:
                        if resp.status_code != 200:
                            body = (await resp.aread()).decode(errors="ignore")
                            if self._model_problem(resp.status_code, body) and i + 1 < len(candidates):
                                continue
                            raise ProviderError(f"{self.name}: HTTP {resp.status_code}: {body[:200]}")
                        self._working[role] = model
                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            chunk = line[5:].strip()
                            if chunk == "[DONE]":
                                break
                            try:
                                delta = json.loads(chunk)["choices"][0].get("delta", {}).get("content")
                            except (json.JSONDecodeError, KeyError, IndexError):
                                continue
                            if delta:
                                yield delta
                        return
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name}: network error: {exc}") from exc

    async def vision(self, prompt: str, image_b64: str, mime: str = "image/jpeg") -> ChatResult:
        if not self.vision_model:
            return await super().vision(prompt, image_b64, mime)
        content = [{"type": "text", "text": prompt},
                   {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{image_b64}"}}]
        payload = {"model": self.vision_model, "messages": [{"role": "user", "content": content}],
                   "max_tokens": 700, "temperature": 0.2}
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=payload)
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name}: network error: {exc}") from exc
        if resp.status_code != 200:
            raise ProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:200]}")
        text = resp.json()["choices"][0]["message"]["content"] or ""
        return ChatResult(text=text, provider=self.name, model=self.vision_model)

    async def embeddings(self, texts: list[str]) -> list[list[float]]:
        if not self.embed_model:
            return await super().embeddings(texts)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/embeddings", headers=self._headers(),
                                         json={"model": self.embed_model, "input": texts})
        except httpx.HTTPError as exc:
            raise ProviderError(f"{self.name}: network error: {exc}") from exc
        if resp.status_code != 200:
            raise ProviderError(f"{self.name}: HTTP {resp.status_code}: {resp.text[:200]}")
        return [d["embedding"] for d in resp.json()["data"]]
