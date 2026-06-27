"""Text-to-music provider runner. Replicate (MusicGen) when keyed, else mock composition plan."""
from __future__ import annotations

import asyncio

from mata.common.config import settings


async def run_music(prompt: str, params: dict) -> tuple[str, dict]:
    duration = params.get("duration_seconds", 30)
    genre = params.get("genre")
    variant = params.get("variant", 0)

    if settings.replicate_api_token:
        import httpx

        async with httpx.AsyncClient(timeout=600) as client:
            create = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={"Authorization": f"Token {settings.replicate_api_token}"},
                json={
                    "version": "meta/musicgen",  # replace with a real version id
                    "input": {"prompt": f"{genre + ' ' if genre else ''}{prompt}", "duration": duration, "seed": variant + 1},
                },
            )
            create.raise_for_status()
            pred = create.json()
            poll_url = pred["urls"]["get"]
            while pred["status"] not in ("succeeded", "failed", "canceled"):
                await asyncio.sleep(3)
                pred = (await client.get(poll_url, headers={"Authorization": f"Token {settings.replicate_api_token}"})).json()
            if pred["status"] != "succeeded":
                raise RuntimeError(f"Music generation {pred['status']}")
            return pred["output"], {"provider": "replicate", "duration": duration, "genre": genre}

    # Mock: produce a distinct arrangement per variant (different tempo / key / structure).
    await asyncio.sleep(0.8)
    structures = [
        ["intro", "verse", "chorus", "verse", "chorus", "outro"],
        ["intro", "build-up", "drop", "break", "drop", "outro"],
        ["ambient intro", "theme A", "theme B", "theme A", "climax", "fade out"],
    ]
    keys = ["Do mayor", "La menor", "Sol mayor", "Mi menor"]
    bpms = [120, 90, 140, 100]
    arrangement = [{"section": s, "bars": 4} for s in structures[variant % len(structures)]]
    return (
        "data:audio/wav;base64,MOCK_AUDIO_PLACEHOLDER",
        {
            "provider": "mock",
            "variant": variant + 1,
            "duration": duration,
            "genre": genre,
            "tonalidad": keys[variant % len(keys)],
            "bpm": bpms[variant % len(bpms)],
            "arrangement": arrangement,
        },
    )
