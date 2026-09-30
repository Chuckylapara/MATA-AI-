"""Async SQLAlchemy engine, session factory, and FastAPI dependency."""
from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from mata.common.config import settings


def _normalize_db_url(url: str) -> str:
    """Accept the plain Postgres URL that managed hosts (Render) provide and make it
    async-driver compatible. Also drop libpq-only query params asyncpg rejects."""
    if url.startswith("postgres://"):
        url = "postgresql+asyncpg://" + url[len("postgres://"):]
    elif url.startswith("postgresql://"):
        url = "postgresql+asyncpg://" + url[len("postgresql://"):]
    # asyncpg doesn't understand ?sslmode=...; strip it (SSL handled by connect_args if needed).
    if "?" in url and "asyncpg" in url:
        url = url.split("?", 1)[0]
    return url


_raw_db_url = settings.database_url
# Managed Postgres (Neon, Supabase, etc.) requires SSL and signals it via
# ?sslmode=require. We strip the param (asyncpg rejects it) but must then enable
# SSL explicitly, or the connection is refused.
_needs_ssl = "sslmode=require" in _raw_db_url or "sslmode=verify" in _raw_db_url
_db_url = _normalize_db_url(_raw_db_url)
_is_sqlite = _db_url.startswith("sqlite")
_engine_kwargs: dict = {"echo": False}
if _is_sqlite:
    # SQLite (dev) doesn't use a connection pool sizing; share one connection.
    from sqlalchemy.pool import StaticPool

    _engine_kwargs.update(connect_args={"check_same_thread": False}, poolclass=StaticPool)
else:
    _engine_kwargs.update(pool_pre_ping=True, pool_size=5, max_overflow=10)
    if _needs_ssl:
        import ssl as _ssl

        _engine_kwargs["connect_args"] = {"ssl": _ssl.create_default_context()}

engine = create_async_engine(_db_url, **_engine_kwargs)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    """Declarative base shared by all models."""


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


log = logging.getLogger("mata.db")

#: Live database status, shown by /healthz so a broken database is visible instead of silent 500s.
DB_STATE: dict = {"backend": _db_url.split(":", 1)[0], "fallback": False, "error": None}


async def _use_sqlite_fallback(reason: str) -> None:
    """Switch every session to a local SQLite file when the configured database is unreachable.

    Free hosted Postgres instances expire (Render deletes free databases after 30 days); without
    this the whole API answers 500. The fallback keeps the site usable — data is stored on the
    server's local disk, which free hosts wipe on redeploy, so point DATABASE_URL at a working
    database to make it permanent. Disable with DB_FALLBACK_SQLITE=0.
    """
    global engine
    from sqlalchemy.pool import StaticPool

    path = os.getenv("DB_FALLBACK_PATH", "./mata_fallback.db")
    fallback = create_async_engine(f"sqlite+aiosqlite:///{path}", echo=False,
                                   connect_args={"check_same_thread": False}, poolclass=StaticPool)
    engine = fallback
    SessionLocal.configure(bind=fallback)
    DB_STATE.update(backend="sqlite", fallback=True, error=reason[:300])
    log.error("Database unreachable (%s). Using local SQLite fallback at %s", reason[:200], path)


async def init_db() -> None:
    """Create tables on startup (dev). Use Alembic migrations in production."""
    # Import models so they register on Base.metadata.
    from mata.common import models  # noqa: F401
    from mata.nexus import models as nexus_models  # noqa: F401

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        DB_STATE["error"] = None
    except Exception as exc:  # noqa: BLE001 — any connection/auth/DNS failure
        if _is_sqlite or DB_STATE["fallback"] or os.getenv("DB_FALLBACK_SQLITE", "1") != "1":
            DB_STATE["error"] = str(exc)[:300]
            raise
        await _use_sqlite_fallback(f"{type(exc).__name__}: {exc}")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
