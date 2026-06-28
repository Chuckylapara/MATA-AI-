"""Viral AI Studio service: idea -> analysis -> storyboard -> per-scene images.

This is the orchestration layer on top of the existing image/video/music modules.
Text steps use the shared LLM brain (Claude > Gemini > mock); image generation
reuses the platform's image provider (Imagen > OpenAI > Pollinations > SVG mock).
"""
from __future__ import annotations

from fastapi import Depends
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.schemas import (
    StudioIdeaIn,
    StudioRenderIn,
    StudioSceneImagesIn,
    StudioStoryboardIn,
    StudioSubtitlesIn,
    StudioVoiceoverIn,
)
from mata.services.image.providers import PollinationsImageProvider, get_image_provider
from mata.services.studio import brain, kie, render, subtitles, voice

app = create_app("Studio")

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
    provider = get_image_provider()
    used = getattr(provider, "name", "unknown")
    images: list[str] = []
    try:
        try:
            images = await provider.generate(body.prompt, size, body.n, body.style)
        except Exception:  # noqa: BLE001 — degrade to the free provider
            fallback = PollinationsImageProvider()
            images = await fallback.generate(body.prompt, size, body.n, body.style)
            used = fallback.name
    except Exception:  # noqa: BLE001 — free provider failed too
        if kie.kie_enabled():
            try:
                images = [await kie.generate_image(body.prompt, body.aspect_ratio) for _ in range(body.n)]
                used = "kie"
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


@app.post("/render")
async def render_video(
    body: StudioRenderIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Assemble scenes (images + narration + optional subtitles) into a real .mp4."""
    reservation = await authorize(db, identity.user_id, "studio_render")
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
    except Exception as exc:  # noqa: BLE001
        await refund(db, reservation)
        await db.commit()
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Render failed: {exc}") from exc
    await settle(db, reservation, reservation.amount, meta={"step": "render", "scenes": result["scenes"]})
    await db.commit()
    # Make the served path public (gateway/devserver expose the studio app under /studio).
    result["url"] = f"/studio{result['url']}"
    return result
