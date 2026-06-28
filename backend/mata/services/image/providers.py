"""Image provider adapters. Gemini (Imagen 4) > OpenAI (DALL·E) > Pollinations (free) > SVG mock."""
from __future__ import annotations

import base64
import hashlib
import urllib.parse

from mata.common.config import settings


def _mock_image(prompt: str, size: str) -> str:
    h = hashlib.sha256(prompt.encode()).hexdigest()
    c1, c2 = f"#{h[0:6]}", f"#{h[6:12]}"
    w, _, ht = size.partition("x")
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{ht or w}">'
        f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>'
        f'</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>'
        f'<text x="50%" y="50%" fill="white" font-size="20" text-anchor="middle">{prompt[:40]}</text></svg>'
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode()).decode()


class MockImageProvider:
    name = "mock"

    async def generate(self, prompt: str, size: str, n: int, style: str | None) -> list[str]:
        return [_mock_image(f"{prompt}#{i}", size) for i in range(n)]


class GeminiImageProvider:
    """Imagen 4 via Google AI Studio API key."""
    name = "gemini-imagen4"

    def _aspect_ratio(self, size: str) -> str:
        w, _, h = size.partition("x")
        try:
            ratio = int(w) / int(h or w)
        except (ValueError, ZeroDivisionError):
            return "1:1"
        if ratio > 1.6:
            return "16:9"
        if ratio < 0.65:
            return "9:16"
        return "1:1"

    async def generate(self, prompt: str, size: str, n: int, style: str | None) -> list[str]:
        import httpx

        full_prompt = f"{prompt}. Style: {style}" if style else prompt
        aspect = self._aspect_ratio(size)
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models"
            f"/imagen-4.0-generate-001:predict?key={settings.gemini_api_key}"
        )
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                url,
                json={
                    "instances": [{"prompt": full_prompt}],
                    "parameters": {"sampleCount": n, "aspectRatio": aspect},
                },
            )
            resp.raise_for_status()
            predictions = resp.json().get("predictions", [])
            return [
                f"data:image/png;base64,{p['bytesBase64Encoded']}"
                for p in predictions
                if "bytesBase64Encoded" in p
            ]


class OpenAIImageProvider:
    name = "openai"

    async def generate(self, prompt: str, size: str, n: int, style: str | None) -> list[str]:
        import httpx

        full_prompt = f"{prompt}. Style: {style}" if style else prompt
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://api.openai.com/v1/images/generations",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                json={"model": "gpt-image-1", "prompt": full_prompt, "n": n, "size": size},
            )
            resp.raise_for_status()
            data = resp.json()["data"]
            return [d.get("url") or f"data:image/png;base64,{d['b64_json']}" for d in data]


class PollinationsImageProvider:
    """Free text-to-image generation (no API key). Returns on-demand image URLs."""
    name = "pollinations"

    async def generate(self, prompt: str, size: str, n: int, style: str | None) -> list[str]:
        width, _, height = size.partition("x")
        width = width or "1024"
        height = height or "1024"
        full_prompt = f"{prompt}, {style}" if style else prompt
        encoded = urllib.parse.quote(full_prompt)
        return [
            f"https://image.pollinations.ai/prompt/{encoded}"
            f"?width={width}&height={height}&seed={i + 1}&nologo=true"
            for i in range(n)
        ]


class FallbackImageProvider:
    """Tries each provider in priority order, returning the first success.

    Guarantees the endpoint always delivers: Pollinations (free, no key) and the
    SVG mock are always appended as last resorts, so a misconfigured or quota-blocked
    premium key (e.g. a Gemini key without Imagen enabled) never breaks generation.
    Provider errors are logged but never propagated, so upstream API keys embedded in
    error URLs are never leaked to the client.
    """
    name = "fallback"

    def __init__(self, providers: list):
        self._providers = providers

    async def generate(self, prompt: str, size: str, n: int, style: str | None) -> list[str]:
        import logging

        last_exc: Exception | None = None
        for provider in self._providers:
            try:
                urls = await provider.generate(prompt, size, n, style)
                if urls:
                    return urls
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                # Log the provider name only — never the raw error (may embed the API key).
                logging.getLogger("mata.image").warning("Image provider %r failed; trying next.", provider.name)
        # Pollinations/mock are always in the chain, so this is effectively unreachable.
        raise RuntimeError(f"All image providers failed (last: {type(last_exc).__name__})")


def get_image_provider():
    chain: list = []
    if settings.gemini_api_key:
        chain.append(GeminiImageProvider())
    if settings.openai_api_key:
        chain.append(OpenAIImageProvider())
    # Free, keyless provider + offline mock guarantee the chain always succeeds.
    chain.append(PollinationsImageProvider())
    chain.append(MockImageProvider())
    return FallbackImageProvider(chain)
