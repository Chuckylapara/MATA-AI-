"""Shared Gemini client with automatic retry on transient errors (503/429/500).

Google's free tier frequently returns 503 (overloaded) or 429 (rate limit). We retry
with exponential backoff so a transient blip doesn't surface as an error to the user.
"""
from __future__ import annotations

import asyncio

import httpx

from mata.common.config import settings

_TRANSIENT = {429, 500, 502, 503, 504}

# Free-tier models that have available quota and stay responsive (probed live).
# The configured model is tried first, then these as fallbacks on transient errors.
_FALLBACK_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
]


async def gemini_generate(
    *,
    contents: list[dict],
    system: str | None = None,
    model: str | None = None,
    temperature: float = 0.7,
    retries_per_model: int = 2,
) -> str:
    body: dict = {"contents": contents, "generationConfig": {"temperature": temperature}}
    if system:
        body["system_instruction"] = {"parts": [{"text": system}]}
    headers = {"x-goog-api-key": settings.gemini_api_key}

    # Build the ordered model chain (configured first, no duplicates).
    chain: list[str] = []
    for m in [model or settings.gemini_model, *_FALLBACK_MODELS]:
        if m and m not in chain:
            chain.append(m)

    last_error = ""
    async with httpx.AsyncClient(timeout=120) as client:
        for model_name in chain:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
            for attempt in range(retries_per_model):
                try:
                    resp = await client.post(url, headers=headers, json=body)
                except httpx.RequestError as exc:
                    last_error = f"{model_name}: network error: {exc}"
                    await asyncio.sleep(1 + attempt)
                    continue

                if resp.status_code == 200:
                    parts = resp.json().get("candidates", [{}])[0].get("content", {}).get("parts", [])
                    return "".join(p.get("text", "") for p in parts)

                last_error = f"{model_name}: {resp.status_code} {resp.text[:160]}"
                if resp.status_code in _TRANSIENT:
                    if attempt < retries_per_model - 1:
                        await asyncio.sleep(1 + attempt)
                        continue
                    break  # move on to the next model in the chain
                # Non-retryable (e.g. 400 bad request) — stop trying this chain.
                raise RuntimeError(f"Gemini error {last_error}")

    raise RuntimeError(f"All Gemini models unavailable. Last: {last_error}")
