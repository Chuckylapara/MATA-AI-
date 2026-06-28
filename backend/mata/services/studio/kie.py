"""kie.ai client — a unified backup provider for images, image→video and music.

kie.ai aggregates many models (Seedream/Flux images, Kling/Veo/Runway video, Suno
music) behind one async job API. Used here as a reliable fallback when the free/
configured providers fail. Reads the key from KIE_API_KEY (settings.kie_api_key);
every call is a no-op (returns None) when the key is absent, so nothing breaks.

API shape:
  POST {BASE}/api/v1/jobs/createTask   {model, input}        -> {data:{taskId}}
  GET  {BASE}/api/v1/jobs/recordInfo?taskId=...              -> {data:{state, resultJson}}
  POST {BASE}/api/v1/generate          (Suno music)          -> {data:{taskId}}
  GET  {BASE}/api/v1/generate/record-info?taskId=...
"""
from __future__ import annotations

import asyncio
import json

import httpx

from mata.common.config import settings

BASE = "https://api.kie.ai"
_IMAGE_SIZE = {
    "9:16": "portrait_16_9",
    "16:9": "landscape_16_9",
    "1:1": "square_hd",
}


def kie_enabled() -> bool:
    return bool(settings.kie_api_key)


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.kie_api_key}", "Content-Type": "application/json"}


async def _create_task(model: str, payload: dict) -> str:
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BASE}/api/v1/jobs/createTask",
            headers=_headers(),
            json={"model": model, "input": payload},
        )
        resp.raise_for_status()
        data = resp.json()
        task_id = (data.get("data") or {}).get("taskId")
        if not task_id:
            raise RuntimeError(f"kie createTask: no taskId ({data.get('msg')})")
        return task_id


async def _poll_job(task_id: str, *, max_wait: int = 300) -> list[str]:
    """Poll recordInfo until success; return resultUrls. Raises on failure/timeout."""
    async with httpx.AsyncClient(timeout=60) as client:
        waited = 0.0
        delay = 3.0
        while waited < max_wait:
            await asyncio.sleep(delay)
            waited += delay
            delay = min(delay + 1, 8)
            resp = await client.get(
                f"{BASE}/api/v1/jobs/recordInfo", headers=_headers(), params={"taskId": task_id}
            )
            resp.raise_for_status()
            data = resp.json().get("data") or {}
            state = data.get("state")
            if state == "success":
                result = json.loads(data.get("resultJson") or "{}")
                urls = result.get("resultUrls") or []
                if not urls:
                    raise RuntimeError("kie job success but no resultUrls")
                return urls
            if state == "fail":
                raise RuntimeError(f"kie job failed: {data.get('failMsg') or data.get('failCode')}")
    raise RuntimeError("kie job timed out")


async def generate_image(prompt: str, aspect_ratio: str, resolution: str = "1K") -> str:
    """Text-to-image via Seedream 4. Returns a public image URL."""
    urls = await _poll_job(
        await _create_task(
            "bytedance/seedream-v4-text-to-image",
            {
                "prompt": prompt[:5000],
                "image_size": _IMAGE_SIZE.get(aspect_ratio, "portrait_16_9"),
                "image_resolution": resolution,
            },
        )
    )
    return urls[0]


async def image_to_video(prompt: str, image_url: str, duration: int = 5) -> str:
    """Animate a still image via Kling 2.6. Returns a public video URL."""
    urls = await _poll_job(
        await _create_task(
            "kling-2.6/image-to-video",
            {
                "prompt": (prompt or "cinematic motion")[:1000],
                "image_urls": [image_url],
                "sound": False,
                "duration": "10" if duration > 7 else "5",
            },
        ),
        max_wait=420,
    )
    return urls[0]


async def generate_music(prompt: str, *, model: str = "V4_5") -> str:
    """Instrumental background track via Suno. Returns a public audio URL."""
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            f"{BASE}/api/v1/generate",
            headers=_headers(),
            json={
                "prompt": prompt[:200],
                "customMode": False,
                "instrumental": True,
                "model": model,
                # Polling is used; a callback URL is required by the API but unused here.
                "callBackUrl": "https://example.com/none",
            },
        )
        resp.raise_for_status()
        task_id = (resp.json().get("data") or {}).get("taskId")
        if not task_id:
            raise RuntimeError("kie suno: no taskId")

        waited, delay = 0.0, 4.0
        while waited < 240:
            await asyncio.sleep(delay)
            waited += delay
            delay = min(delay + 1, 10)
            poll = await client.get(
                f"{BASE}/api/v1/generate/record-info", headers=_headers(), params={"taskId": task_id}
            )
            poll.raise_for_status()
            data = poll.json().get("data") or {}
            status = (data.get("status") or data.get("state") or "").lower()
            # Suno returns nested results once tracks are ready.
            resp_data = data.get("response") or data.get("data") or {}
            tracks = resp_data.get("sunoData") or resp_data.get("data") or []
            if tracks:
                audio = tracks[0].get("audioUrl") or tracks[0].get("audio_url")
                if audio:
                    return audio
            if "fail" in status or "error" in status:
                raise RuntimeError(f"kie suno failed: {data.get('errorMessage') or status}")
    raise RuntimeError("kie suno timed out")
