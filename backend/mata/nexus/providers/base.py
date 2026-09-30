"""ModelProvider interface — every model backend implements this.

Business logic never imports a vendor SDK; it asks the ModelRouter for a role
(fast / reasoning / vision / embeddings) and gets one of these.
"""
from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any


class ProviderError(RuntimeError):
    """A provider call failed (network, auth, quota, bad response)."""


class CapabilityNotSupported(ProviderError):
    pass


@dataclass
class ChatMessage:
    role: str  # "user" | "assistant"
    content: str


@dataclass
class ChatResult:
    text: str
    provider: str
    model: str
    usage: dict[str, int] = field(default_factory=dict)


def as_dicts(messages: list[ChatMessage] | list[dict]) -> list[dict]:
    out = []
    for m in messages:
        if isinstance(m, ChatMessage):
            out.append({"role": m.role, "content": m.content})
        else:
            out.append({"role": m["role"], "content": m["content"]})
    return out


_JSON_FENCE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def extract_json(text: str) -> Any:
    """Best-effort parse of a JSON value out of model text."""
    text = text.strip()
    m = _JSON_FENCE.search(text)
    if m:
        text = m.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start, end = text.find(opener), text.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise ProviderError(f"Model did not return valid JSON: {text[:160]!r}")


class ModelProvider(ABC):
    name: str = "base"
    #: subset of {"chat", "stream", "vision", "embeddings", "json", "tools"}
    capabilities: set[str] = set()
    #: True for providers that run on the user's machine
    local: bool = False

    def model_for(self, role: str) -> str:  # pragma: no cover - overridden
        return "unknown"

    @abstractmethod
    async def chat(
        self, messages: list[ChatMessage] | list[dict], *, system: str = "", temperature: float = 0.6,
        max_tokens: int = 1024, role: str = "reasoning",
    ) -> ChatResult: ...

    async def stream(
        self, messages: list[ChatMessage] | list[dict], *, system: str = "", temperature: float = 0.6,
        max_tokens: int = 1024, role: str = "reasoning",
    ) -> AsyncIterator[str]:
        # Default: non-streaming fallback emitted in one chunk.
        res = await self.chat(messages, system=system, temperature=temperature, max_tokens=max_tokens, role=role)
        yield res.text

    async def vision(self, prompt: str, image_b64: str, mime: str = "image/jpeg") -> ChatResult:
        raise CapabilityNotSupported(f"{self.name} does not support vision")

    async def embeddings(self, texts: list[str]) -> list[list[float]]:
        raise CapabilityNotSupported(f"{self.name} does not support embeddings")

    async def structured_output(
        self, messages: list[ChatMessage] | list[dict], schema: dict, *, system: str = "",
        temperature: float = 0.2, role: str = "reasoning",
    ) -> dict:
        """Ask for JSON matching `schema`; one repair retry on invalid output."""
        instr = (
            "Respond ONLY with a single JSON object that matches this JSON Schema. "
            "No prose, no code fences.\nSchema: " + json.dumps(schema)
        )
        full_system = f"{system}\n\n{instr}" if system else instr
        res = await self.chat(messages, system=full_system, temperature=temperature, max_tokens=1500, role=role)
        try:
            data = extract_json(res.text)
        except ProviderError:
            repair = [*as_dicts(messages), {"role": "assistant", "content": res.text},
                      {"role": "user", "content": "That was not valid JSON. Reply with ONLY the JSON object."}]
            res = await self.chat(repair, system=full_system, temperature=0, max_tokens=1500, role=role)
            data = extract_json(res.text)
        if not isinstance(data, dict):
            raise ProviderError("Structured output was not a JSON object")
        missing = [k for k in schema.get("required", []) if k not in data]
        if missing:
            raise ProviderError(f"Structured output missing required keys: {missing}")
        return data
