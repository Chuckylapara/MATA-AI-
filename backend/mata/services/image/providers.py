"""Image provider adapters. OpenAI (DALL·E) or Replicate when keyed, else SVG mock."""
from __future__ import annotations

import base64
import hashlib
import urllib.parse

from mata.common.config import settings


def _mock_image(prompt: str, size: str) -> str:
    """Deterministic placeholder: an SVG data-URL seeded from the prompt."""
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
        # Different seed per image so a batch returns distinct results.
        return [
            f"https://image.pollinations.ai/prompt/{encoded}"
            f"?width={width}&height={height}&seed={i + 1}&nologo=true"
            for i in range(n)
        ]


def get_image_provider():
    if settings.openai_api_key:
        return OpenAIImageProvider()
    # Free, keyless real image generation (default).
    return PollinationsImageProvider()
