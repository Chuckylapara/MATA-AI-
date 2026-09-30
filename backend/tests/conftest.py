"""Test setup: isolated in-memory SQLite, no provider keys, no background scheduler."""
from __future__ import annotations

import os

os.environ.update({
    "DATABASE_URL": "sqlite+aiosqlite:///:memory:",
    "DEV_INMEMORY": "1",
    "NEXUS_SCHEDULER": "0",
    "JWT_SECRET": "test-secret-test-secret-test-secret-123",
})
for _k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "NVIDIA_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY",
           "OLLAMA_BASE_URL", "SEARXNG_URL", "TAVILY_API_KEY", "BRAVE_API_KEY", "GOOGLE_CLIENT_ID",
           "GOOGLE_CLIENT_SECRET", "EBAY_APP_ID"):
    os.environ[_k] = ""

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from mata.common.db import SessionLocal, init_db  # noqa: E402
from mata.common.models import User  # noqa: E402
from mata.common.security import create_access_token, hash_password  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _db():
    await init_db()
    yield


async def _make_user(email: str) -> str:
    async with SessionLocal() as db:
        u = User(email=email, hashed_password=hash_password("x" * 12))
        db.add(u)
        await db.commit()
        return u.id


_counter = {"n": 0}


@pytest_asyncio.fixture
async def user_id() -> str:
    _counter["n"] += 1
    return await _make_user(f"u{_counter['n']}@test.dev")


@pytest_asyncio.fixture
async def other_user_id() -> str:
    _counter["n"] += 1
    return await _make_user(f"other{_counter['n']}@test.dev")


def token_for(uid: str) -> str:
    return create_access_token(user_id=uid, role="user", tier="free")


@pytest_asyncio.fixture
async def client(user_id):
    from mata.services.nexus.app import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test",
                           headers={"Authorization": f"Bearer {token_for(user_id)}"}) as c:
        c.user_id = user_id  # type: ignore[attr-defined]
        yield c


@pytest.fixture
def anyio_backend():
    return "asyncio"
