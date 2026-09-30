"""ModelRouter: picks a provider per role and falls back on failure.

Roles: fast, reasoning, vision, embeddings. See docs/AI_MODEL_STRATEGY.md.
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator

from mata.common.config import Settings, settings
from mata.nexus.events import EventName, bus
from mata.nexus.providers import ModelProvider, ProviderError, build_providers
from mata.nexus.providers.base import ChatResult

log = logging.getLogger("nexus.router")

PREFERENCE: dict[str, list[str]] = {
    "fast": ["groq", "ollama", "nvidia", "gemini", "anthropic", "openai", "mock"],
    "reasoning": ["anthropic", "openai", "nvidia", "gemini", "groq", "ollama", "mock"],
    "vision": ["anthropic", "gemini", "nvidia", "openai", "ollama"],
    "embeddings": ["ollama", "openai", "gemini"],
}
_CAP = {"fast": "chat", "reasoning": "chat", "vision": "vision", "embeddings": "embeddings"}


class NoProviderAvailable(ProviderError):
    pass


class ModelRouter:
    def __init__(self, providers: dict[str, ModelProvider] | None = None, cfg: Settings | None = None) -> None:
        self.cfg = cfg or settings
        self.providers = providers if providers is not None else build_providers(self.cfg)

    def _override(self, role: str) -> str | None:
        return {
            "fast": self.cfg.nexus_fast_provider, "reasoning": self.cfg.nexus_reasoning_provider,
            "vision": self.cfg.nexus_vision_provider, "embeddings": self.cfg.nexus_embed_provider,
        }.get(role)

    def chain(self, role: str) -> list[ModelProvider]:
        order = list(PREFERENCE[role])
        if (forced := self._override(role)) and forced in self.providers:
            order = [forced, *(n for n in order if n != forced)]
        cap = _CAP[role]
        return [self.providers[n] for n in order if n in self.providers and cap in self.providers[n].capabilities]

    def primary(self, role: str) -> ModelProvider | None:
        c = self.chain(role)
        return c[0] if c else None

    @property
    def using_mock(self) -> bool:
        p = self.primary("reasoning")
        return p is None or p.name == "mock"

    def describe(self) -> dict:
        out = {}
        for role in PREFERENCE:
            p = self.primary(role)
            out[role] = {"provider": p.name if p else None, "model": p.model_for(role) if p else None,
                         "local": bool(p and p.local), "fallbacks": [x.name for x in self.chain(role)[1:]]}
        return out

    async def _fallback_event(self, role: str, failed: str, error: str, user_id: str | None) -> None:
        log.warning("provider %s failed for %s: %s", failed, role, error)
        await bus.publish(EventName.PROVIDER_FALLBACK, user_id, role=role, provider=failed, error=error[:200])

    async def chat(self, messages, *, role: str = "reasoning", user_id: str | None = None, **kw) -> ChatResult:
        errors = []
        for p in self.chain(role):
            try:
                return await p.chat(messages, role=role, **kw)
            except ProviderError as exc:
                errors.append(f"{p.name}: {exc}")
                await self._fallback_event(role, p.name, str(exc), user_id)
        raise NoProviderAvailable("; ".join(errors) or f"No provider configured for role '{role}'")

    async def stream(self, messages, *, role: str = "reasoning", user_id: str | None = None, **kw) -> AsyncIterator[str]:
        errors = []
        for p in self.chain(role):
            emitted = False
            try:
                async for chunk in p.stream(messages, role=role, **kw):
                    emitted = True
                    yield chunk
                return
            except ProviderError as exc:
                if emitted:  # can't transparently switch mid-answer
                    raise
                errors.append(f"{p.name}: {exc}")
                await self._fallback_event(role, p.name, str(exc), user_id)
        raise NoProviderAvailable("; ".join(errors) or f"No provider configured for role '{role}'")

    async def structured(self, messages, schema: dict, *, role: str = "reasoning", user_id: str | None = None,
                         **kw) -> tuple[dict, str]:
        errors = []
        for p in self.chain(role):
            try:
                return await p.structured_output(messages, schema, role=role, **kw), p.name
            except ProviderError as exc:
                errors.append(f"{p.name}: {exc}")
                await self._fallback_event(role, p.name, str(exc), user_id)
        raise NoProviderAvailable("; ".join(errors) or "No provider configured")

    async def vision(self, prompt: str, image_b64: str, mime: str = "image/jpeg",
                     user_id: str | None = None) -> ChatResult:
        errors = []
        for p in self.chain("vision"):
            try:
                return await p.vision(prompt, image_b64, mime)
            except ProviderError as exc:
                errors.append(f"{p.name}: {exc}")
                await self._fallback_event("vision", p.name, str(exc), user_id)
        raise NoProviderAvailable("; ".join(errors) or "No vision provider configured")


_router: ModelRouter | None = None


def get_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = ModelRouter()
    return _router


def set_router(router: ModelRouter | None) -> None:
    """Test hook."""
    global _router
    _router = router
