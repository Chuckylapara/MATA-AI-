"""All-in-one DEV server (no Docker required).

Mounts every service under the same path prefixes the gateway would expose
(/auth, /chat, /image, ...), so the frontend talks to ONE origin (http://localhost:8000).
Auth works because mata.common.deps decodes the Bearer token directly when no
gateway headers are present. Async video/music workers run as background tasks.

Run:  SERVICE=devserver DEV_INMEMORY=1 DATABASE_URL=sqlite+aiosqlite:///./mata.db \
      uvicorn run:app --port 8000
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from mata.common.config import settings
from mata.common.db import init_db
from mata.common.jobs import run_worker
from mata.services.admin.app import app as admin_app
from mata.services.agent.app import app as agent_app
from mata.services.auth.app import _seed_admin
from mata.services.auth.app import app as auth_app
from mata.services.billing.app import app as billing_app
from mata.services.chat.app import app as chat_app
from mata.services.code.app import app as code_app
from mata.services.image.app import app as image_app
from mata.services.music.app import app as music_app
from mata.services.music.providers import run_music
from mata.services.video.app import app as video_app
from mata.services.video.providers import run_video

_MOUNTS = {
    "/auth": auth_app,
    "/chat": chat_app,
    "/image": image_app,
    "/video": video_app,
    "/music": music_app,
    "/code": code_app,
    "/agent": agent_app,
    "/billing": billing_app,
    "/admin": admin_app,
}

_worker_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _seed_admin()
    # Background async-generation workers (in-memory queue, single process).
    _worker_tasks.append(asyncio.create_task(run_worker("video", run_video)))
    _worker_tasks.append(asyncio.create_task(run_worker("music", run_music)))
    yield
    for t in _worker_tasks:
        t.cancel()


app = FastAPI(title="Mata AI · Dev (all-in-one)", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "mode": "devserver", "mounts": list(_MOUNTS)}


for prefix, sub in _MOUNTS.items():
    app.mount(prefix, sub)
