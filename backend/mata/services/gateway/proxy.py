"""HTTP reverse-proxy helper with streaming passthrough."""
from __future__ import annotations

import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))

_HOP_BY_HOP = {"content-encoding", "content-length", "transfer-encoding", "connection"}


async def proxy(request: Request, base_url: str, path: str, headers: dict) -> Response:
    url = f"{base_url}/{path}"
    body = await request.body()

    req = _client.build_request(
        request.method,
        url,
        headers=headers,
        params=request.query_params,
        content=body,
    )
    upstream = await _client.send(req, stream=True)

    # Stream (e.g. chat SSE) transparently.
    if upstream.headers.get("content-type", "").startswith("text/event-stream"):
        async def body_iter():
            async for chunk in upstream.aiter_raw():
                yield chunk
            await upstream.aclose()

        return StreamingResponse(
            body_iter(),
            status_code=upstream.status_code,
            media_type="text/event-stream",
        )

    content = await upstream.aread()
    await upstream.aclose()
    out_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP}
    return Response(content=content, status_code=upstream.status_code, headers=out_headers)
