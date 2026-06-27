"""Image generation service (synchronous)."""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import Generation, JobStatus
from mata.common.schemas import ImageRequest
from mata.services.image.providers import get_image_provider

app = create_app("Image")


@app.post("/generations")
async def generate(body: ImageRequest, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    reservation = await authorize(db, identity.user_id, "image", units=body.n)
    gen = Generation(user_id=identity.user_id, module="image", prompt=body.prompt, params=body.model_dump(), status=JobStatus.running)
    db.add(gen)
    await db.flush()
    try:
        urls = await get_image_provider().generate(body.prompt, body.size, body.n, body.style)
    except Exception as exc:  # noqa: BLE001
        await refund(db, reservation)
        gen.status = JobStatus.failed
        gen.error = str(exc)
        return {"id": gen.id, "status": "failed", "error": str(exc)}

    gen.status = JobStatus.succeeded
    gen.result_data = {"images": urls}
    gen.result_url = urls[0]
    await settle(db, reservation, reservation.amount, meta={"count": body.n})
    return {"id": gen.id, "status": "succeeded", "images": urls}


@app.get("/generations")
async def history(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Generation)
        .where(Generation.user_id == identity.user_id, Generation.module == "image")
        .order_by(Generation.created_at.desc())
        .limit(50)
    )
    return [{"id": g.id, "prompt": g.prompt, "status": g.status.value, "images": (g.result_data or {}).get("images", [])} for g in res.scalars()]
