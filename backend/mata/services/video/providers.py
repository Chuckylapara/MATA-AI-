"""Text-to-video provider runner. Replicate when keyed, else mock (returns a poster + plan)."""
from __future__ import annotations

import asyncio

from mata.common.config import settings


async def run_video(prompt: str, params: dict) -> tuple[str, dict]:
    duration = params.get("duration_seconds", 5)
    aspect = params.get("aspect_ratio", "16:9")
    variant = params.get("variant", 0)

    if settings.replicate_api_token:
        import httpx

        async with httpx.AsyncClient(timeout=600) as client:
            # Example: Replicate text-to-video model. Polls until complete.
            create = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={"Authorization": f"Token {settings.replicate_api_token}"},
                json={
                    "version": "stable-video-diffusion",  # replace with a real version id
                    "input": {"prompt": prompt, "num_frames": duration * 24, "seed": variant + 1},
                },
            )
            create.raise_for_status()
            pred = create.json()
            poll_url = pred["urls"]["get"]
            while pred["status"] not in ("succeeded", "failed", "canceled"):
                await asyncio.sleep(3)
                pred = (await client.get(poll_url, headers={"Authorization": f"Token {settings.replicate_api_token}"})).json()
            if pred["status"] != "succeeded":
                raise RuntimeError(f"Video generation {pred['status']}")
            url = pred["output"][0] if isinstance(pred["output"], list) else pred["output"]
            return url, {"provider": "replicate", "duration": duration, "aspect": aspect}

    # Mock: simulate render time and return a distinct storyboard per variant.
    await asyncio.sleep(1.0)
    styles = [
        ["plano general", "primer plano", "cámara lenta", "vista aérea"],
        ["plano cenital", "travelling lateral", "contrapicado", "plano detalle"],
        ["gran angular", "zoom in", "panorámica", "plano secuencia"],
    ]
    shots = styles[variant % len(styles)]
    moods = ["cinematográfico", "vibrante y enérgico", "onírico y suave"]
    storyboard = [
        {"t": round(i * duration / 4, 1), "scene": f"{shots[i]}: {prompt[:50]}"} for i in range(4)
    ]
    return (
        "data:video/mp4;base64,MOCK_VIDEO_PLACEHOLDER",
        {
            "provider": "mock",
            "variant": variant + 1,
            "estilo": moods[variant % len(moods)],
            "duration": duration,
            "aspect": aspect,
            "storyboard": storyboard,
        },
    )
