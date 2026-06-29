"""Clips service: turn a long video (upload or URL) into short vertical clips.

Pipeline (runs in the background, poll for status):
    ingest (yt-dlp / upload) -> transcribe -> pick highlights (LLM) -> cut + reframe
    9:16 + burn captions -> N short mp4s.

Mirrors the Studio render pattern: a Generation row tracks status; the heavy ffmpeg
work runs in an asyncio task so the HTTP request never times out.
"""
from __future__ import annotations

import asyncio
import logging
import shutil
import uuid
from pathlib import Path

from fastapi import Depends, File, Form, HTTPException, UploadFile, status
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.credits import CREDIT_COSTS, Reservation, authorize, refund, settle
from mata.common.db import SessionLocal, get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import Generation, JobStatus
from mata.services.clips import clipper, highlights, ingest, transcribe

log = logging.getLogger("mata.clips")
app = create_app("Clips")

OUTPUT_DIR = Path(__file__).resolve().parents[3] / "_clips"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Public path through the gateway / devserver mount is /clips/files/...
app.mount("/files", StaticFiles(directory=str(OUTPUT_DIR)), name="files")

MAX_CLIPS = 10


async def _run_pipeline(
    gen_id: str,
    user_id: str,
    *,
    source_path: Path | None,
    url: str | None,
    num_clips: int,
    target_min: int,
    target_max: int,
    reframe: str,
    burn_subtitles: bool,
    language: str,
    reserved: int,
) -> None:
    job = uuid.uuid4().hex[:12]
    work = OUTPUT_DIR / f"work_{job}"
    work.mkdir(parents=True, exist_ok=True)
    produced: list[dict] = []
    try:
        # 1) Get the source video onto disk.
        if url:
            source = await ingest.fetch_from_url(url, work)
        elif source_path and source_path.exists():
            source = await ingest.save_upload(source_path, work)
        else:
            raise ingest.IngestError("No se proporcionó ni archivo ni URL.")

        # 2) Transcribe, 3) pick the best moments.
        tr = await transcribe.transcribe(source, work)
        moments = await highlights.find_highlights(
            tr["segments"],
            num_clips=num_clips,
            target_min=target_min,
            target_max=target_max,
            language=language,
        )

        # 4) Cut + reframe + caption each moment.
        for i, m in enumerate(moments):
            out_name = f"clip_{job}_{i:02d}.mp4"
            try:
                meta = await clipper.make_clip(
                    source,
                    start=m["start"],
                    end=m["end"],
                    idx=i,
                    work=work,
                    out_dir=OUTPUT_DIR,
                    out_name=out_name,
                    reframe=reframe,
                    burn_subtitles=burn_subtitles,
                    segments=tr["segments"],
                )
            except Exception as exc:  # noqa: BLE001 — skip a bad clip, keep the rest
                log.warning("clip %s/%s failed: %s", gen_id, i, exc)
                continue
            produced.append({
                "url": f"/clips/files/{out_name}",
                "title": m.get("title", f"Clip {i + 1}"),
                "duration": meta["duration"],
                "start": round(m["start"], 1),
                "end": round(m["end"], 1),
            })

        if not produced:
            raise RuntimeError("No se pudo generar ningún clip a partir del video.")

        async with SessionLocal() as db:
            gen = (await db.execute(select(Generation).where(Generation.id == gen_id))).scalar_one_or_none()
            if gen:
                gen.status = JobStatus.succeeded
                gen.result_url = produced[0]["url"]
                gen.result_data = {"clips": produced, "count": len(produced)}
            # Charge only for clips actually produced; refund the rest.
            actual = len(produced) * CREDIT_COSTS["clips"]
            await settle(db, Reservation(user_id, "clips", reserved), actual, meta={"clips": len(produced)})
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        log.warning("clips job %s failed: %s", gen_id, exc)
        async with SessionLocal() as db:
            gen = (await db.execute(select(Generation).where(Generation.id == gen_id))).scalar_one_or_none()
            if gen:
                gen.status = JobStatus.failed
                gen.error = str(exc)[:500]
            await refund(db, Reservation(user_id, "clips", reserved))
            await db.commit()
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.post("/jobs", status_code=202)
async def submit(
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
    url: str | None = Form(default=None),
    num_clips: int = Form(default=3),
    target_min: int = Form(default=20),
    target_max: int = Form(default=60),
    reframe: str = Form(default="center"),
    burn_subtitles: bool = Form(default=True),
    language: str = Form(default="es"),
    file: UploadFile | None = File(default=None),
):
    """Start a clip job. Provide either a `url` or upload a `file` (multipart)."""
    num_clips = max(1, min(num_clips, MAX_CLIPS))
    target_min = max(5, min(target_min, 120))
    target_max = max(target_min + 5, min(target_max, 180))
    if reframe not in ("center", "face"):
        reframe = "center"
    if not url and file is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Proporciona una URL o sube un archivo de video.")

    # Reserve credits up-front for the requested number of clips (refunded if fewer).
    reservation = await authorize(db, identity.user_id, "clips", units=num_clips)

    # If a file was uploaded, persist it now (the UploadFile dies with the request).
    source_path: Path | None = None
    if file is not None:
        staging = OUTPUT_DIR / f"upload_{uuid.uuid4().hex[:12]}.mp4"
        with staging.open("wb") as out:
            shutil.copyfileobj(file.file, out)
        source_path = staging

    gen = Generation(
        user_id=identity.user_id,
        module="clips",
        prompt=(url or (file.filename if file else "upload") or "clip")[:200],
        params={"num_clips": num_clips, "reframe": reframe, "source": "url" if url else "upload"},
        status=JobStatus.running,
    )
    db.add(gen)
    await db.commit()

    asyncio.create_task(_run_pipeline(
        gen.id, identity.user_id,
        source_path=source_path, url=url,
        num_clips=num_clips, target_min=target_min, target_max=target_max,
        reframe=reframe, burn_subtitles=burn_subtitles, language=language,
        reserved=reservation.amount,
    ))
    return {"job_id": gen.id, "status": "running"}


@app.get("/jobs/{job_id}")
async def poll(job_id: str, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    gen = (await db.execute(
        select(Generation).where(Generation.id == job_id, Generation.user_id == identity.user_id)
    )).scalar_one_or_none()
    if not gen:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job no encontrado")
    return {
        "id": gen.id,
        "status": gen.status.value,
        "clips": (gen.result_data or {}).get("clips", []),
        "error": gen.error,
    }


@app.get("/jobs")
async def list_jobs(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Generation)
        .where(Generation.user_id == identity.user_id, Generation.module == "clips")
        .order_by(Generation.created_at.desc())
        .limit(50)
    )
    jobs = res.scalars().all()
    return {
        "count": len(jobs),
        "jobs": [
            {
                "id": g.id,
                "status": g.status.value,
                "prompt": g.prompt,
                "clips": (g.result_data or {}).get("clips", []),
                "created_at": g.created_at,
            }
            for g in jobs
        ],
    }
