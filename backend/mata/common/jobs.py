"""Generic async-generation job helpers shared by video & music (and batch image).

Flow:
  create_job()  -> reserves credits, writes a queued Generation, enqueues to Redis.
  run_worker()  -> long-running loop: dequeue, call provider, settle/refund, update row.
  get_job()     -> poll status/result.
"""
from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.credits import authorize, refund, settle
from mata.common.db import SessionLocal
from mata.common.models import Generation, JobStatus
from mata.common.redis_client import dequeue, enqueue

# A provider runner takes (prompt, params) and returns (result_url, result_data).
ProviderRunner = Callable[[str, dict], Awaitable[tuple[str, dict]]]


async def create_job(db: AsyncSession, user_id: str, module: str, prompt: str, params: dict) -> Generation:
    reservation = await authorize(db, user_id, module, units=1)
    gen = Generation(user_id=user_id, module=module, prompt=prompt, params=params, status=JobStatus.queued)
    db.add(gen)
    await db.flush()
    await enqueue(module, {"generation_id": gen.id, "reservation_amount": reservation.amount})
    return gen


async def get_job(db: AsyncSession, user_id: str, generation_id: str) -> Generation:
    res = await db.execute(
        select(Generation).where(Generation.id == generation_id, Generation.user_id == user_id)
    )
    gen = res.scalar_one_or_none()
    if not gen:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return gen


async def run_worker(module: str, runner: ProviderRunner) -> None:
    """Blocking worker loop. Run as: SERVICE=<module> ROLE=worker python -m mata.worker"""
    from mata.common.credits import Reservation
    from mata.common.db import init_db

    await init_db()
    print(f"[worker:{module}] started", flush=True)
    while True:
        msg = await dequeue(module, timeout=5)
        if msg is None:
            await asyncio.sleep(0.1)
            continue
        gen_id = msg["generation_id"]
        async with SessionLocal() as db:
            gen = (await db.execute(select(Generation).where(Generation.id == gen_id))).scalar_one_or_none()
            if not gen:
                continue
            gen.status = JobStatus.running
            await db.commit()
            reservation = Reservation(user_id=gen.user_id, module=module, amount=msg["reservation_amount"])
            try:
                result_url, result_data = await runner(gen.prompt, gen.params)
                gen.status = JobStatus.succeeded
                gen.result_url = result_url
                gen.result_data = result_data
                await settle(db, reservation, reservation.amount, meta={"module": module})
            except Exception as exc:  # noqa: BLE001
                gen.status = JobStatus.failed
                gen.error = str(exc)
                await refund(db, reservation)
            await db.commit()
            print(f"[worker:{module}] {gen_id} -> {gen.status.value}", flush=True)
