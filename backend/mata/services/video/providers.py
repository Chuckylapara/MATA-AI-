"""Text-to-video provider runner. Gemini (Veo 3) > Replicate > mock storyboard."""
from __future__ import annotations

import asyncio

from mata.common.config import settings


async def _run_gemini_video(prompt: str, duration: int, aspect: str, variant: int) -> str:
    """Veo 3 via Google AI Studio long-running operation."""
    import httpx

    aspect_map = {"16:9": "16:9", "9:16": "9:16", "1:1": "1:1", "4:3": "4:3"}
    api_aspect = aspect_map.get(aspect, "16:9")

    async with httpx.AsyncClient(timeout=600) as client:
        # Submit long-running prediction
        resp = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models"
            f"/veo-3.0-generate-preview:predictLongRunning?key={settings.gemini_api_key}",
            json={
                "instances": [{"prompt": prompt}],
                "parameters": {
                    "aspectRatio": api_aspect,
                    "durationSeconds": min(duration, 8),
                    "seed": variant + 1,
                },
            },
        )
        resp.raise_for_status()
        operation_name = resp.json().get("name", "")

        # Poll until done
        for _ in range(120):
            await asyncio.sleep(5)
            poll = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/{operation_name}"
                f"?key={settings.gemini_api_key}",
            )
            poll.raise_for_status()
            data = poll.json()
            if data.get("done"):
                response = data.get("response", {})
                predictions = response.get("predictions", [])
                if predictions:
                    p = predictions[0]
                    video_b64 = p.get("bytesBase64Encoded")
                    if video_b64:
                        return f"data:video/mp4;base64,{video_b64}"
                    video_uri = p.get("videoUri") or p.get("gcsUri")
                    if video_uri:
                        return video_uri
                raise RuntimeError("Veo 3 succeeded but no video in response")
        raise RuntimeError("Veo 3 timed out")


async def run_video(prompt: str, params: dict) -> tuple[str, dict]:
    duration = params.get("duration_seconds", 5)
    aspect = params.get("aspect_ratio", "16:9")
    variant = params.get("variant", 0)

    if settings.gemini_api_key:
        try:
            url = await _run_gemini_video(prompt, duration, aspect, variant)
            return url, {"provider": "gemini-veo3", "duration": duration, "aspect": aspect}
        except Exception as exc:
            # Fall through to mock on error
            import logging
            logging.getLogger(__name__).warning("Veo 3 failed, using mock: %s", exc)

    if settings.replicate_api_token:
        import httpx

        async with httpx.AsyncClient(timeout=600) as client:
            create = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={"Authorization": f"Token {settings.replicate_api_token}"},
                json={
                    "version": "stable-video-diffusion",
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

    # Mock storyboard
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
