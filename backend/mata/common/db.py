"""Async SQLAlchemy engine, session factory, and FastAPI dependency."""
from __future__ import annotations

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


async def init_db() -> None:
    """Create tables on startup (dev). Use Alembic migrations in production."""
    # Import models so they register on Base.metadata.
    from mata.common import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
