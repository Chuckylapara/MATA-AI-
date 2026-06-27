"""Code generation service: generate / explain / review / fix."""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import Generation, JobStatus
from mata.common.schemas import CodeRequest

app = create_app("Code")

_SYSTEM = {
    "generate": "You are an expert {lang} engineer. Output only production-ready {lang} code with brief inline comments.",
    "explain": "You are a senior engineer. Explain the following {lang} code clearly and concisely.",
    "review": "You are a strict code reviewer. Review the {lang} code; list bugs, risks, and improvements.",
    "fix": "You are a debugging expert. Fix the {lang} code and explain what was wrong.",
}


async def _complete(system: str, prompt: str) -> str:
    if settings.anthropic_api_key:
        from anthropic import AsyncAnthropic

        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        msg = await client.messages.create(
            model=settings.code_model,
            max_tokens=4096,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        )
        return "".join(b.text for b in msg.content if b.type == "text")

    if settings.gemini_api_key:
        from mata.common.gemini import gemini_generate

        return await gemini_generate(
            contents=[{"role": "user", "parts": [{"text": prompt}]}], system=system
        )

    # Mock
    return f"# [Mata AI mock] {system}\n# Request: {prompt[:120]}\n\ndef solution():\n    raise NotImplementedError\n"


@app.post("/generations")
async def generate(body: CodeRequest, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    reservation = await authorize(db, identity.user_id, "code", units=1)
    gen = Generation(user_id=identity.user_id, module="code", prompt=body.prompt, params=body.model_dump(), status=JobStatus.running)
    db.add(gen)
    await db.flush()
    system = _SYSTEM[body.mode].format(lang=body.language)
    try:
        output = await _complete(system, body.prompt)
    except Exception as exc:  # noqa: BLE001
        await refund(db, reservation)
        gen.status = JobStatus.failed
        gen.error = str(exc)
        return {"id": gen.id, "status": "failed", "error": str(exc)}

    gen.status = JobStatus.succeeded
    gen.result_data = {"code": output, "language": body.language, "mode": body.mode}
    await settle(db, reservation, reservation.amount, meta={"mode": body.mode, "language": body.language})
    return {"id": gen.id, "status": "succeeded", "code": output, "language": body.language, "mode": body.mode}
