"""Text-to-music provider runner. Gemini (Lyria 3) > Replicate (MusicGen) > mock."""
from __future__ import annotations

import asyncio

from mata.common.config import settings


async def _run_lyria(prompt: str, duration: int, genre: str | None, variant: int) -> str:
    """Lyria 3 via Google AI Studio long-running operation."""
    import httpx

    full_prompt = f"{genre} {prompt}" if genre else prompt
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            "https://generativelanguage.googleapis.com/v1beta/models"
            f"/lyria-realtime-exp:predictLongRunning?key={settings.gemini_api_key}",
            json={
                "instances": [{"prompt": full_prompt}],
                "parameters": {"durationSeconds": duration, "seed": variant + 1},
            },
        )
        resp.raise_for_status()
        operation_name = resp.json().get("name", "")

        for _ in range(200):
            await asyncio.sleep(3)
            poll = await client.get(
                f"https://generativelanguage.googleapis.com/v1beta/{operation_name}"
                f"?key={settings.gemini_api_key}",
            )
            poll.raise_for_status()
            data = poll.json()
            if data.get("done"):
                predictions = data.get("response", {}).get("predictions", [])
                if predictions:
                    p = predictions[0]
                    audio_b64 = p.get("bytesBase64Encoded") or p.get("audioBase64")
                    if audio_b64:
                        return f"data:audio/wav;base64,{audio_b64}"
                    uri = p.get("audioUri") or p.get("gcsUri")
                    if uri:
                        return uri
                raise RuntimeError("Lyria succeeded but no audio in response")
        raise RuntimeError("Lyria timed out")


async def run_music(prompt: str, params: dict) -> tuple[str, dict]:
    duration = params.get("duration_seconds", 30)
    genre = params.get("genre")
    variant = params.get("variant", 0)

    if settings.gemini_api_key:
        try:
            url = await _run_lyria(prompt, duration, genre, variant)
            return url, {"provider": "gemini-lyria3", "duration": duration, "genre": genre}
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Lyria failed, using mock: %s", exc)

    if settings.replicate_api_token:
        import httpx

        async with httpx.AsyncClient(timeout=600) as client:
            create = await client.post(
                "https://api.replicate.com/v1/predictions",
                headers={"Authorization": f"Token {settings.replicate_api_token}"},
                json={
                    "version": "meta/musicgen",
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

    if settings.hf_token:
        import base64

        import httpx

        full_prompt = f"{genre} {prompt}" if genre else prompt
        url = f"https://api-inference.huggingface.co/models/{settings.hf_music_model}"
        headers = {"Authorization": f"Bearer {settings.hf_token}"}
        try:
            async with httpx.AsyncClient(timeout=300) as client:
                for _ in range(4):
                    resp = await client.post(url, headers=headers, json={"inputs": full_prompt})
                    ctype = resp.headers.get("content-type", "")
                    if resp.status_code == 200 and ctype.startswith("audio/"):
                        b64 = base64.b64encode(resp.content).decode()
                        return f"data:{ctype};base64,{b64}", {"provider": "huggingface", "duration": duration, "genre": genre}
                    if resp.status_code in (503, 429):
                        wait = 8.0
                        try:
                            wait = float(resp.json().get("estimated_time", wait))
                        except Exception:  # noqa: BLE001
                            pass
                        await asyncio.sleep(min(wait, 25) + 1)
                        continue
                    break
        except Exception as exc:  # noqa: BLE001
            import logging
            logging.getLogger(__name__).warning("HF MusicGen failed, using mock: %s", exc)

    # Mock composition plan
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
