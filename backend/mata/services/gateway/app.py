"""API Gateway: single public entrypoint.

Responsibilities:
  * Verify JWT (except on public auth routes) and inject X-User-* headers downstream.
  * Per-user, per-tier rate limiting (Redis).
  * Reverse-proxy to the correct internal service.
  * Stream responses (chat) transparently.
"""
from __future__ import annotations

import jwt
from fastapi import HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import TIER_POLICY
from mata.common.models import Tier
from mata.common.redis_client import rate_limit
from mata.common.security import decode_token
from mata.services.gateway.proxy import proxy

app = create_app("Gateway", init_database=False)

# prefix -> (internal base url, requires_auth)
SERVICE_MAP = {
    "auth": (settings.auth_service_url, False),
    "chat": (settings.chat_service_url, True),
    "image": (settings.image_service_url, True),
    "video": (settings.video_service_url, True),
    "music": (settings.music_service_url, True),
    "code": (settings.code_service_url, True),
    "agent": (settings.agent_service_url, True),
    "billing": (settings.billing_service_url, True),
    "admin": (settings.admin_service_url, True),
}

# Auth routes that don't need a token.
PUBLIC_AUTH_PATHS = {"register", "login", "refresh"}


def _verify(authorization: str | None) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")
    try:
        payload = decode_token(authorization.split(" ", 1)[1])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    if payload.get("type") != "access":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong token type")
    return payload


@app.api_route("/{service}/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def route(service: str, path: str, request: Request) -> Response:
    if service not in SERVICE_MAP:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown service '{service}'")

    base_url, requires_auth = SERVICE_MAP[service]
    headers = dict(request.headers)
    headers.pop("host", None)

    is_public = service == "auth" and path.strip("/") in PUBLIC_AUTH_PATHS

    if requires_auth and not is_public:
        payload = _verify(request.headers.get("authorization"))
        tier = payload.get("tier", "free")

        # Rate limit by user + tier policy.
        limit = TIER_POLICY[Tier(tier)]["rate_limit_per_min"]
        if not await rate_limit(f"{payload['sub']}:{service}", limit):
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded")

        # Admin-only service.
        if service == "admin" and payload.get("role") != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")

        headers["x-user-id"] = payload["sub"]
        headers["x-user-role"] = payload.get("role", "user")
        headers["x-user-tier"] = tier

    return await proxy(request, base_url, path, headers)
