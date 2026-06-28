"""Viral AI Studio service: idea -> analysis -> storyboard -> per-scene images.

This is the orchestration layer on top of the existing image/video/music modules.
Text steps use the shared LLM brain (Claude > Gemini > mock); image generation
reuses the platform's image provider (Imagen > OpenAI > Pollinations > SVG mock).
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import Depends, HTTPException, status
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import Reservation, authorize, refund, settle
from mata.common.db import SessionLocal, get_db
from mata.common.deps import Identity, get_identity
from mata.common.llm import active_provider
from mata.common.models import Generation, JobStatus
from mata.common.schemas import (
    StudioIdeaIn,
    StudioRenderIn,
    StudioSceneImagesIn,
    StudioStoryboardIn,
    StudioSubtitlesIn,
    StudioThumbnailIn,
    StudioVoiceoverIn,
)
from mata.services.image.providers import PollinationsImageProvider, get_image_provider
from mata.services.studio import brain, kie, render, subtitles, voice

app = create_app("Studio")

@app.get("/diag")
async def diag(probe: bool = False, identity: Identity = Depends(get_identity)):
    """Provider diagnostics (booleans only — never exposes key values).
    Add ?probe=1 to attempt one real kie image call and return the raw error."""
    out: dict = {
        "kie_enabled": kie.kie_enabled(),
        "gemini": bool(settings.gemini_api_key),
        "openai": bool(settings.openai_api_key),
        "elevenlabs": bool(settings.elevenlabs_api_key),
        "llm_provider": active_provider(),
    }
    if probe and kie.kie_enabled():
        try:
            url = await kie.generate_image("a simple blue circle on white", "1:1")
            out["kie_probe"] = {"ok": True, "url_prefix": url[:60]}
        except Exception as exc:  # noqa: BLE001
            out["kie_probe"] = {"ok": False, "error": str(exc)[:400]}
    return out


# Serve rendered .mp4 files. Public path is /studio/files/... through the gateway.
app.mount("/files", StaticFiles(directory=str(render.OUTPUT_DIR)), name="files")


@app.post("/analyze")
async def analyze(
    body: StudioIdeaIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    reservation = await authorize(db, identity.user_id, "studio_analyze")
    try:
        result = await brain.analyze(body.idea)
    finally:
        await settle(db, reservation, reservation.amount, meta={"step": "analyze"})
        await db.commit()
    return result


@app.post("/storyboard")
async def storyboard(
    body: StudioStoryboardIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    reservation = await authorize(db, identity.user_id, "studio_storyboard")
    try:
        analysis = body.analysis or await brain.analyze(body.idea)
        board = await brain.storyboard(body.idea, analysis, body.target_seconds, body.aspect_ratio)
    finally:
        await settle(db, reservation, reservation.amount, meta={"step": "storyboard"})
        await db.commit()
    return {
        "analysis": analysis,
        "style_guide": board.get("style_guide", {}),
        "escenas": board.get("escenas", []),
        "provider": board.get("_provider"),
        "aspect_ratio": body.aspect_ratio,
    }


@app.post("/scene-images")
async def scene_images(
    body: StudioSceneImagesIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Generate images for a single scene prompt, metered as `image` per picture.

    Falls back to the free Pollinations provider if the configured provider fails
    (e.g. Imagen not enabled on the key) so the storyboard always renders. Credits
    are refunded if no image could be produced at all.
    """
    reservation = await authorize(db, identity.user_id, "image", units=body.n)
    size = brain.aspect_to_size(body.aspect_ratio)
    images: list[str] = []
    used = "none"
    # Primary: kie.ai (Seedream) when configured.
    if kie.kie_enabled():
        try:
            images = [await kie.generate_image(body.prompt, body.aspect_ratio) for _ in range(body.n)]
            used = "kie"
        except Exception:  # noqa: BLE001
            images = []
    # Fallback: configured provider, then free Pollinations.
    if not images:
        provider = get_image_provider()
        used = getattr(provider, "name", "unknown")
        try:
            images = await provider.generate(body.prompt, size, body.n, body.style)
        except Exception:  # noqa: BLE001
            try:
                fallback = PollinationsImageProvider()
                images = await fallback.generate(body.prompt, size, body.n, body.style)
                used = fallback.name
            except Exception:  # noqa: BLE001
                images = []
    if not images:
        await refund(db, reservation)
        await db.commit()
        return {"images": [], "provider": "none"}
    await settle(db, reservation, reservation.amount, meta={"step": "scene-images", "n": body.n, "provider": used})
    await db.commit()
    return {"images": images, "provider": used}


@app.post("/voiceover")
async def voiceover(
    body: StudioVoiceoverIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Synthesize narration to a base64 audio data URL (free Google TTS fallback)."""
    reservation = await authorize(db, identity.user_id, "studio_voiceover")
    try:
        audio_url, provider = await voice.synthesize(body.text, body.voice, body.language)
    except Exception:  # noqa: BLE001
        await refund(db, reservation)
        await db.commit()
        return {"audio": None, "provider": "none"}
    await settle(db, reservation, reservation.amount, meta={"step": "voiceover", "provider": provider})
    await db.commit()
    return {"audio": audio_url, "provider": provider}


@app.post("/subtitles")
async def make_subtitles(
    body: StudioSubtitlesIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Build an SRT/VTT file from the storyboard scenes, optionally translated."""
    reservation = await authorize(db, identity.user_id, "studio_subtitles")
    lines = [str(s.get("narracion", "")) for s in body.escenas]
    if body.language:
        lines = await subtitles.translate(lines, body.language)
    content = subtitles.build(body.escenas, lines, body.fmt)
    await settle(db, reservation, reservation.amount, meta={"step": "subtitles", "fmt": body.fmt})
    await db.commit()
    return {
        "content": content,
        "fmt": body.fmt,
        "filename": f"subtitulos.{body.fmt}",
        "mime": "text/vtt" if body.fmt == "vtt" else "application/x-subrip",
    }


async def _run_render_job(gen_id: str, body: StudioRenderIn, user_id: str, reserved: int) -> None:
    """Background worker: render the .mp4, then update the video record + credits.

    Runs after the HTTP response is sent, so long renders never time out the request.
    """
    try:
        result = await render.render_project(
            body.escenas,
            aspect_ratio=body.aspect_ratio,
            resolution=body.resolution,
            voice_name=body.voice,
            language=body.language,
            burn_subtitles=body.burn_subtitles,
            animate=body.animate,
            background_music=body.background_music,
        )
        result["url"] = f"/studio{result['url']}"
        async with SessionLocal() as db:
            gen = (await db.execute(select(Generation).where(Generation.id == gen_id))).scalar_one_or_none()
            if gen:
                gen.status = JobStatus.succeeded
                gen.result_url = result["url"]
                gen.result_data = result
                params = dict(gen.params or {})
                params.update({"duration": result.get("duration"), "resolution": result.get("resolution")})
                gen.params = params
            await settle(db, Reservation(user_id, "studio_render", reserved), reserved, meta={"step": "render"})
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        logging.getLogger("mata.studio").warning("Render job %s failed: %s", gen_id, exc)
        async with SessionLocal() as db:
            gen = (await db.execute(select(Generation).where(Generation.id == gen_id))).scalar_one_or_none()
            if gen:
                gen.status = JobStatus.failed
                gen.error = str(exc)[:500]
            await refund(db, Reservation(user_id, "studio_render", reserved))
            await db.commit()


@app.post("/render")
async def render_video(
    body: StudioRenderIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Start an async render job. Returns immediately with a video_id to poll.

    The heavy ffmpeg work runs in the background (see /videos/{id} for status),
    so videos of any length never hit the HTTP request timeout.
    """
    reservation = await authorize(db, identity.user_id, "studio_render")
    gen = Generation(
        user_id=identity.user_id,
        module="studio_video",
        prompt=(body.title or "Video")[:200],
        params={
            "title": body.title or "Video",
            "aspect_ratio": body.aspect_ratio,
            "resolution": body.resolution,
            "scenes": len(body.escenas),
        },
        status=JobStatus.running,
    )
    db.add(gen)
    await db.commit()
    asyncio.create_task(_run_render_job(gen.id, body, identity.user_id, reservation.amount))
    return {"video_id": gen.id, "status": "running"}


@app.get("/videos/{video_id}")
async def video_status(video_id: str, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    """Poll a single render job's status (running → succeeded/failed)."""
    gen = (await db.execute(
        select(Generation).where(Generation.id == video_id, Generation.user_id == identity.user_id)
    )).scalar_one_or_none()
    if not gen:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Video no encontrado")
    return {
        "id": gen.id,
        "status": gen.status.value,
        "url": gen.result_url,
        "title": (gen.params or {}).get("title"),
        "duration": (gen.params or {}).get("duration"),
        "resolution": (gen.params or {}).get("resolution"),
        "error": gen.error,
    }


@app.get("/videos")
async def list_videos(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    """The user's rendered videos — powers the control panel / history."""
    res = await db.execute(
        select(Generation)
        .where(Generation.user_id == identity.user_id, Generation.module == "studio_video")
        .order_by(Generation.created_at.desc())
        .limit(100)
    )
    vids = res.scalars().all()
    total_seconds = sum((g.params or {}).get("duration", 0) or 0 for g in vids)
    return {
        "count": len(vids),
        "total_minutes": round(total_seconds / 60, 1),
        "videos": [
            {
                "id": g.id,
                "title": (g.params or {}).get("title", "Video"),
                "url": g.result_url,
                "duration": (g.params or {}).get("duration"),
                "resolution": (g.params or {}).get("resolution"),
                "aspect_ratio": (g.params or {}).get("aspect_ratio"),
                "status": g.status.value,
                "created_at": g.created_at,
            }
            for g in vids
        ],
    }


@app.post("/thumbnail")
async def thumbnail(
    body: StudioThumbnailIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Generate a viral-style thumbnail image for the video title (Paso 9)."""
    reservation = await authorize(db, identity.user_id, "image", units=1)
    size = brain.aspect_to_size(body.aspect_ratio)
    prompt = (
        f"YouTube thumbnail, bold cinematic, eye-catching, high contrast, dramatic lighting "
        f"for a video titled: {body.title}"
    )
    images: list[str] = []
    if kie.kie_enabled():
        try:
            images = [await kie.generate_image(prompt, body.aspect_ratio)]
        except Exception:  # noqa: BLE001
            images = []
    if not images:
        try:
            images = await PollinationsImageProvider().generate(prompt, size, 1, body.style)
        except Exception:  # noqa: BLE001
            images = []
    if not images:
        await refund(db, reservation)
        await db.commit()
        return {"thumbnail": None}
    await settle(db, reservation, reservation.amount, meta={"step": "thumbnail"})
    await db.commit()
    return {"thumbnail": images[0]}
