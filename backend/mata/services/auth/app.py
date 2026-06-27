"""Auth service: register, login, refresh, logout, current user, admin seed."""
from __future__ import annotations

from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.db import SessionLocal, get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import RefreshToken, Role, Tier, User
from mata.common.schemas import LoginIn, RefreshIn, RegisterIn, TokenPair, UserOut
from mata.common.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)

async def _seed_admin() -> None:
    async with SessionLocal() as db:
        res = await db.execute(select(User).where(User.email == settings.seed_admin_email))
        if res.scalar_one_or_none() is None:
            db.add(
                User(
                    email=settings.seed_admin_email,
                    hashed_password=hash_password(settings.seed_admin_password),
                    full_name="Mata Admin",
                    role=Role.admin,
                    tier=Tier.business,
                    credits=1_000_000,
                )
            )
            await db.commit()


app = create_app("Auth", on_startup=_seed_admin)


def _issue_tokens(db: AsyncSession, user: User) -> TokenPair:
    access = create_access_token(user_id=user.id, role=user.role.value, tier=user.tier.value)
    raw_refresh, token_hash, expires = create_refresh_token(user_id=user.id)
    db.add(RefreshToken(user_id=user.id, token_hash=token_hash, expires_at=expires))
    return TokenPair(access_token=access, refresh_token=raw_refresh)


@app.post("/register", response_model=TokenPair, status_code=201)
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)) -> TokenPair:
    exists = await db.execute(select(User).where(User.email == body.email))
    if exists.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
    )
    db.add(user)
    await db.flush()
    return _issue_tokens(db, user)


@app.post("/login", response_model=TokenPair)
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)) -> TokenPair:
    res = await db.execute(select(User).where(User.email == body.email))
    user = res.scalar_one_or_none()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled")
    return _issue_tokens(db, user)


@app.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshIn, db: AsyncSession = Depends(get_db)) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token)
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid refresh token")
    if payload.get("type") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")

    token_hash = hash_token(body.refresh_token)
    res = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    stored = res.scalar_one_or_none()
    if not stored or stored.revoked:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired or revoked")
    # SQLite returns naive datetimes (no tz); normalize to UTC before comparing.
    expires_at = stored.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Refresh token expired or revoked")

    # Rotate: revoke the old token, issue a new pair.
    stored.revoked = True
    user = (await db.execute(select(User).where(User.id == payload["sub"]))).scalar_one()
    return _issue_tokens(db, user)


@app.post("/logout")
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)) -> dict:
    token_hash = hash_token(body.refresh_token)
    res = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
    stored = res.scalar_one_or_none()
    if stored:
        stored.revoked = True
    return {"ok": True}


@app.get("/me", response_model=UserOut)
async def me(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)) -> UserOut:
    res = await db.execute(select(User).where(User.id == identity.user_id))
    user = res.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return UserOut.model_validate(user)
