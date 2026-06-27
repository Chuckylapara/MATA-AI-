"""Password hashing + JWT creation/verification."""
from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from passlib.context import CryptContext

from mata.common.config import settings

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return _pwd.verify(password, hashed)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(*, user_id: str, role: str, tier: str) -> str:
    now = _now()
    payload = {
        "sub": user_id,
        "role": role,
        "tier": tier,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(minutes=settings.access_token_ttl_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(*, user_id: str) -> tuple[str, str, datetime]:
    """Return (raw_token, token_hash, expires_at)."""
    now = _now()
    expires = now + timedelta(days=settings.refresh_token_ttl_days)
    jti = str(uuid.uuid4())
    payload = {"sub": user_id, "type": "refresh", "jti": jti, "iat": now, "exp": expires}
    raw = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return raw, hash_token(raw), expires


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
