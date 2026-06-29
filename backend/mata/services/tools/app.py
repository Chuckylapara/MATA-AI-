"""AI Tools service: free text utilities via Hugging Face (translate, summarize).

Uses the HF Inference "router" endpoint with the user's HF_TOKEN. These models are
free on the hf-inference provider (verified): Helsinki-NLP translation + BART summary.
"""
from __future__ import annotations

import httpx
from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity

app = create_app("Tools")

_HF_BASE = "https://router.huggingface.co/hf-inference/models"

# Translation pairs confirmed available free on hf-inference.
TRANSLATE_PAIRS = {
    ("en", "es"), ("es", "en"), ("en", "fr"), ("fr", "en"),
}
LANG_NAMES = {"en": "Inglés", "es": "Español", "fr": "Francés"}


class TranslateIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    source: str = "en"
    target: str = "es"


class SummarizeIn(BaseModel):
    text: str = Field(min_length=1, max_length=8000)


class VisionIn(BaseModel):
    image: str = Field(min_length=1)  # data URL (data:image/...;base64,...) o URL http
    question: str = Field(default="Describe esta imagen en detalle.", max_length=2000)


async def _hf_text(model: str, payload: dict) -> list | dict:
    if not settings.hf_token:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Falta configurar HF_TOKEN en el servidor.")
    headers = {"Authorization": f"Bearer {settings.hf_token}"}
    async with httpx.AsyncClient(timeout=90) as client:
        resp = await client.post(f"{_HF_BASE}/{model}", headers=headers, json=payload)
    if resp.status_code != 200:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "El modelo no está disponible ahora. Inténtalo de nuevo.")
    return resp.json()


@app.post("/translate")
async def translate(
    body: TranslateIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    if body.source == body.target:
        return {"translation": body.text, "source": body.source, "target": body.target}
    if (body.source, body.target) not in TRANSLATE_PAIRS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Par de idiomas no disponible. Opciones: {', '.join(f'{a}->{b}' for a, b in sorted(TRANSLATE_PAIRS))}",
        )
    reservation = await authorize(db, identity.user_id, "tools")
    try:
        data = await _hf_text(f"Helsinki-NLP/opus-mt-{body.source}-{body.target}", {"inputs": body.text})
        out = (data[0].get("translation_text") if isinstance(data, list) and data else "") or ""
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise
    await settle(db, reservation, reservation.amount, meta={"tool": "translate"})
    await db.commit()
    return {"translation": out, "source": body.source, "target": body.target}


@app.post("/summarize")
async def summarize(
    body: SummarizeIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    reservation = await authorize(db, identity.user_id, "tools")
    try:
        data = await _hf_text("facebook/bart-large-cnn", {"inputs": body.text})
        out = (data[0].get("summary_text") if isinstance(data, list) and data else "") or ""
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise
    await settle(db, reservation, reservation.amount, meta={"tool": "summarize"})
    await db.commit()
    return {"summary": out}


@app.post("/vision")
async def vision(
    body: VisionIn,
    identity: Identity = Depends(get_identity),
    db: AsyncSession = Depends(get_db),
):
    """Analiza una imagen y responde una pregunta sobre ella (NVIDIA VLM)."""
    if not settings.nvidia_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Falta configurar NVIDIA_API_KEY en el servidor.")
    reservation = await authorize(db, identity.user_id, "tools")
    payload = {
        "model": settings.nvidia_vision_model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": body.question},
                {"type": "image_url", "image_url": {"url": body.image}},
            ],
        }],
        "max_tokens": 1024,
        "temperature": 0.2,
    }
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                "https://integrate.api.nvidia.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.nvidia_api_key}"},
                json=payload,
            )
        if resp.status_code != 200:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo analizar la imagen. Prueba con una imagen más pequeña.")
        answer = resp.json()["choices"][0]["message"]["content"]
    except HTTPException:
        await refund(db, reservation)
        await db.commit()
        raise
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Error al analizar la imagen.")
    await settle(db, reservation, reservation.amount, meta={"tool": "vision"})
    await db.commit()
    return {"answer": answer}


@app.get("/languages")
async def languages():
    """Language pairs the translator supports (powers the UI dropdowns)."""
    return {
        "pairs": [{"source": a, "target": b} for a, b in sorted(TRANSLATE_PAIRS)],
        "names": LANG_NAMES,
    }
