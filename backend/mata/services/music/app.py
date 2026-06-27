"""Text-to-music service (async jobs). Submit -> poll."""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.jobs import create_job, get_job
from mata.common.schemas import JobOut, MusicRequest

app = create_app("Music")


@app.post("/jobs", response_model=JobOut, status_code=202)
async def submit(body: MusicRequest, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)) -> JobOut:
    gen = await create_job(db, identity.user_id, "music", body.prompt, body.model_dump())
    return JobOut(id=gen.id, status=gen.status.value)


@app.get("/jobs/{job_id}", response_model=JobOut)
async def poll(job_id: str, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)) -> JobOut:
    gen = await get_job(db, identity.user_id, job_id)
    return JobOut(id=gen.id, status=gen.status.value, result_url=gen.result_url, result_data=gen.result_data, error=gen.error)
