"""Chat service: conversations + streaming completions with credit metering."""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.credits import authorize, settle
from mata.common.db import SessionLocal, get_db
from mata.common.deps import Identity, get_identity, get_identity_optional
from mata.common.models import Conversation, Message
from mata.common.schemas import ChatRequest
from mata.services.chat.providers import estimate_tokens, get_chat_provider

app = create_app("Chat")

# Guest funnel: a few free messages per IP before requiring sign-up. Kept in-memory
# (best-effort, resets on restart) — enough to let new visitors try the product.
GUEST_FREE_MESSAGES = 5
_guest_usage: dict[str, int] = {}


@app.get("/conversations")
async def list_conversations(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Conversation).where(Conversation.user_id == identity.user_id).order_by(Conversation.created_at.desc())
    )
    return [{"id": c.id, "title": c.title, "created_at": c.created_at} for c in res.scalars()]


@app.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: str, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    res = await db.execute(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == identity.user_id)
    )
    convo = res.scalar_one_or_none()
    if not convo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return {
        "id": convo.id,
        "title": convo.title,
        "messages": [{"role": m.role, "content": m.content, "created_at": m.created_at} for m in convo.messages],
    }


async def _get_or_create_conversation(db: AsyncSession, user_id: str, conversation_id: str | None, first_user_msg: str) -> Conversation:
    if conversation_id:
        res = await db.execute(
            select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user_id)
        )
        convo = res.scalar_one_or_none()
        if not convo:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
        return convo
    convo = Conversation(user_id=user_id, title=first_user_msg[:60] or "New conversation")
    db.add(convo)
    await db.flush()
    return convo


@app.post("/completions")
async def completions(
    body: ChatRequest,
    request: Request,
    identity: Identity | None = Depends(get_identity_optional),
):
    """Streaming (SSE) or buffered chat completion. Credits settled on real token usage.

    Guests (no token) get a small number of free messages per IP — no persistence,
    no credit metering — then receive 401 so the client can prompt for sign-up.
    """
    provider = get_chat_provider()
    messages = [m.model_dump() for m in body.messages]
    first_user = next((m["content"] for m in messages if m["role"] == "user"), "")

    # ── Guest path: limited free messages, no DB, no credits ──────────────────
    if identity is None:
        fwd = request.headers.get("x-forwarded-for", "")
        client_ip = fwd.split(",")[0].strip() or (request.client.host if request.client else "unknown")
        used = _guest_usage.get(client_ip, 0)
        if used >= GUEST_FREE_MESSAGES:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Guest message limit reached")
        _guest_usage[client_ip] = used + 1

        async def run_guest() -> AsyncIterator[str]:
            try:
                async for delta in provider.stream(messages, body.model, body.temperature):
                    yield f"data: {json.dumps({'delta': delta})}\n\n"
            except Exception as exc:  # noqa: BLE001
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
                return
            remaining = GUEST_FREE_MESSAGES - _guest_usage[client_ip]
            yield f"data: {json.dumps({'done': True, 'guest_remaining': remaining})}\n\n"

        if body.stream:
            return StreamingResponse(run_guest(), media_type="text/event-stream")
        chunks: list[str] = []
        async for sse in run_guest():
            payload = json.loads(sse.removeprefix("data: ").strip())
            if "delta" in payload:
                chunks.append(payload["delta"])
            elif "error" in payload:
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, payload["error"])
        return {"conversation_id": None, "content": "".join(chunks), "credits": 0}

    async def run() -> AsyncIterator[str]:
        async with SessionLocal() as db:
            convo = await _get_or_create_conversation(db, identity.user_id, body.conversation_id, first_user)
            # Persist the latest user message.
            db.add(Message(conversation_id=convo.id, role="user", content=first_user))

            reservation = await authorize(db, identity.user_id, "chat", units=1)
            await db.commit()

            collected: list[str] = []
            try:
                async for delta in provider.stream(messages, body.model, body.temperature):
                    collected.append(delta)
                    yield f"data: {json.dumps({'delta': delta, 'conversation_id': convo.id})}\n\n"
            except Exception as exc:  # noqa: BLE001
                async with SessionLocal() as db2:
                    from mata.common.credits import refund

                    await refund(db2, reservation)
                    await db2.commit()
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"
                return

            full = "".join(collected)
            tokens = estimate_tokens(first_user) + estimate_tokens(full)
            actual_credits = max(1, tokens // 1000)  # 1 credit / 1k tokens

            async with SessionLocal() as db2:
                db2.add(Message(conversation_id=convo.id, role="assistant", content=full))
                await settle(db2, reservation, actual_credits, tokens=tokens, meta={"model": body.model or "default"})
                await db2.commit()

            yield f"data: {json.dumps({'done': True, 'conversation_id': convo.id, 'credits': actual_credits})}\n\n"

    if body.stream:
        return StreamingResponse(run(), media_type="text/event-stream")

    # Buffered: drain the generator, return JSON.
    chunks: list[str] = []
    conversation_id = body.conversation_id
    credits_used = 0
    async for sse in run():
        payload = json.loads(sse.removeprefix("data: ").strip())
        if "delta" in payload:
            chunks.append(payload["delta"])
            conversation_id = payload["conversation_id"]
        elif "done" in payload:
            credits_used = payload["credits"]
        elif "error" in payload:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, payload["error"])
    return {"conversation_id": conversation_id, "content": "".join(chunks), "credits": credits_used}
