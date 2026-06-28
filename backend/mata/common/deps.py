"""Shared FastAPI dependencies for auth context.

Two modes:
  * Behind the gateway, identity arrives in X-User-* headers (gateway already verified JWT).
  * Standalone (dev / direct service call), a Bearer token is decoded here.
"""
from __future__ import annotations

from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status

from mata.common.security import decode_token


@dataclass
class Identity:
    user_id: str
    role: str
    tier: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


async def get_identity(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    x_user_role: str | None = Header(default=None),
    x_user_tier: str | None = Header(default=None),
) -> Identity:
    # Trusted headers from the gateway.
    if x_user_id:
        return Identity(user_id=x_user_id, role=x_user_role or "user", tier=x_user_tier or "free")

    # Direct Bearer token (dev / internal).
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
        try:
            payload = decode_token(token)
        except jwt.PyJWTError:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
        if payload.get("type") != "access":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
        return Identity(user_id=payload["sub"], role=payload.get("role", "user"), tier=payload.get("tier", "free"))

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


async def get_identity_optional(
    authorization: str | None = Header(default=None),
    x_user_id: str | None = Header(default=None),
    x_user_role: str | None = Header(default=None),
    x_user_tier: str | None = Header(default=None),
) -> Identity | None:
    """Like get_identity, but returns None for anonymous callers instead of raising.

    Used by endpoints that support a limited guest experience (e.g. a few free chat
    messages before requiring sign-up).
    """
    if not x_user_id and not (authorization and authorization.lower().startswith("bearer ")):
        return None
    return await get_identity(authorization, x_user_id, x_user_role, x_user_tier)


def require_role(*roles: str):
    async def _dep(identity: Identity = Depends(get_identity)) -> Identity:
        if identity.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return identity

    return _dep
