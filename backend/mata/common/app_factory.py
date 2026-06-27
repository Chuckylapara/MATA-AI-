"""Helper to build a consistent FastAPI app per service."""
from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mata.common.config import settings
from mata.common.db import init_db


def create_app(
    title: str,
    *,
    init_database: bool = True,
    on_startup: Callable[[], Awaitable[None]] | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if init_database:
            await init_db()
        if on_startup is not None:
            await on_startup()
        yield

    app = FastAPI(title=f"Mata AI · {title}", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz", tags=["meta"])
    async def healthz():
        return {"status": "ok", "service": title}

    return app
