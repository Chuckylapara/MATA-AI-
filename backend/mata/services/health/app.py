"""Mata Health AI service: symptom triage chat, camera scans, vitals log, profile,
weekly reports and wellness tips.

Prevention assistant, not a diagnostic tool — see brain.py for the safety rules
(no definitive diagnosis, no prescriptions, rule-based emergency safety net).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.credits import authorize, refund, settle
from mata.common.db import get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import HealthEntry, HealthEntryKind, HealthProfile, HealthSeverity
from mata.services.health import brain

app = create_app("Health")

VALID_AREAS = set(brain.SCAN_PROMPTS.keys())


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ProfileIn(BaseModel):
    full_name: str | None = None
    age: int | None = Field(default=None, ge=0, le=130)
    weight_kg: float | None = Field(default=None, ge=0, le=500)
    height_cm: float | None = Field(default=None, ge=0, le=300)
    allergies: str | None = None
    medications: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[dict] = Field(default_factory=list)


class ScanIn(BaseModel):
    image: str = Field(min_length=1)  # data URL
    area: str = "general"


class VitalsIn(BaseModel):
    kind: str  # heart_rate | steps | fall
    value: float | int | None = None
    note: str | None = None
    data: dict = Field(default_factory=dict)


def _profile_dict(p: HealthProfile | None) -> dict | None:
    if not p:
        return None
    return {
        "full_name": p.full_name,
        "age": p.age,
        "weight_kg": p.weight_kg,
        "height_cm": p.height_cm,
        "allergies": p.allergies,
        "medications": p.medications,
        "emergency_contact_name": p.emergency_contact_name,
        "emergency_contact_phone": p.emergency_contact_phone,
    }


async def _get_profile(db: AsyncSession, user_id: str) -> HealthProfile | None:
    res = await db.execute(select(HealthProfile).where(HealthProfile.user_id == user_id))
    return res.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------
@app.get("/profile")
async def get_profile(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    profile = await _get_profile(db, identity.user_id)
    return {"profile": _profile_dict(profile)}


@app.put("/profile")
async def upsert_profile(
    body: ProfileIn, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)
):
    profile = await _get_profile(db, identity.user_id)
    if profile is None:
        profile = HealthProfile(user_id=identity.user_id)
        db.add(profile)
    for field, value in body.model_dump().items():
        setattr(profile, field, value)
    await db.commit()
    return {"profile": _profile_dict(profile)}


# ---------------------------------------------------------------------------
# Symptom chat
# ---------------------------------------------------------------------------
@app.post("/chat")
async def chat(body: ChatIn, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    profile = _profile_dict(await _get_profile(db, identity.user_id))
    reservation = await authorize(db, identity.user_id, "health_chat")
    try:
        result = await brain.triage_chat(history=body.history, message=body.message, profile=profile)
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo procesar el mensaje. Inténtalo de nuevo.")

    severity = HealthSeverity.urgent if result.get("emergency") else HealthSeverity.normal
    db.add(HealthEntry(
        user_id=identity.user_id,
        kind=HealthEntryKind.symptom_chat,
        summary=result.get("summary") or body.message[:180],
        data={"message": body.message, "reply": result.get("reply")},
        severity=severity,
    ))
    await settle(db, reservation, reservation.amount, meta={"emergency": result.get("emergency", False)})
    await db.commit()
    return result


# ---------------------------------------------------------------------------
# Camera scanner
# ---------------------------------------------------------------------------
@app.post("/scan")
async def scan(body: ScanIn, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    area = body.area if body.area in VALID_AREAS else "general"
    reservation = await authorize(db, identity.user_id, "health_scan")
    try:
        result = await brain.analyze_scan(image_data_url=body.image, area=area)
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo analizar la imagen. Prueba con una foto más pequeña.")

    severity_str = result.get("severity", "watch")
    try:
        severity = HealthSeverity(severity_str)
    except ValueError:
        severity = HealthSeverity.watch

    db.add(HealthEntry(
        user_id=identity.user_id,
        kind=HealthEntryKind.scan,
        summary=f"[{area}] {result.get('observations', '')[:180]}",
        data={"area": area, **result},
        severity=severity,
    ))
    await settle(db, reservation, reservation.amount, meta={"area": area, "severity": severity_str})
    await db.commit()
    return {"area": area, **result}


# ---------------------------------------------------------------------------
# Vitals (heart rate via camera PPG, step count, fall detection) — free, logged client-side
# ---------------------------------------------------------------------------
@app.post("/vitals")
async def log_vitals(body: VitalsIn, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    kind_map = {"heart_rate": HealthEntryKind.heart_rate, "steps": HealthEntryKind.steps, "fall": HealthEntryKind.fall_alert}
    kind = kind_map.get(body.kind)
    if kind is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "kind debe ser heart_rate, steps o fall")

    severity = HealthSeverity.normal
    summary = body.note or f"{body.kind}: {body.value}"
    if kind is HealthEntryKind.fall_alert:
        severity = HealthSeverity.urgent
        summary = body.note or "Posible caída detectada por el acelerómetro."
    elif kind is HealthEntryKind.heart_rate and body.value:
        if body.value < 40 or body.value > 160:
            severity = HealthSeverity.watch

    entry = HealthEntry(
        user_id=identity.user_id, kind=kind, summary=summary,
        data={"value": body.value, **body.data}, severity=severity,
    )
    db.add(entry)
    await db.commit()
    return {"logged": True, "severity": severity.value}


# ---------------------------------------------------------------------------
# History / entries
# ---------------------------------------------------------------------------
@app.get("/entries")
async def list_entries(
    days: int = 30, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)
):
    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, 365)))
    res = await db.execute(
        select(HealthEntry)
        .where(HealthEntry.user_id == identity.user_id, HealthEntry.created_at >= since)
        .order_by(HealthEntry.created_at.desc())
        .limit(200)
    )
    entries = res.scalars().all()
    return {
        "entries": [
            {
                "id": e.id, "kind": e.kind.value, "summary": e.summary,
                "severity": e.severity.value, "data": e.data, "created_at": e.created_at.isoformat(),
            }
            for e in entries
        ]
    }


# ---------------------------------------------------------------------------
# Weekly report
# ---------------------------------------------------------------------------
@app.get("/report/weekly")
async def weekly_report(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    since = datetime.now(timezone.utc) - timedelta(days=7)
    res = await db.execute(
        select(HealthEntry)
        .where(HealthEntry.user_id == identity.user_id, HealthEntry.created_at >= since)
        .order_by(HealthEntry.created_at.desc())
        .limit(100)
    )
    entries = res.scalars().all()
    profile = _profile_dict(await _get_profile(db, identity.user_id))

    reservation = await authorize(db, identity.user_id, "health_report")
    try:
        report = await brain.weekly_report(
            entries=[{"kind": e.kind.value, "summary": e.summary, "severity": e.severity.value} for e in entries],
            profile=profile,
        )
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo generar el reporte.")
    await settle(db, reservation, reservation.amount)
    await db.commit()
    return {"report": report, "entry_count": len(entries), "period_days": 7}


# ---------------------------------------------------------------------------
# Wellness
# ---------------------------------------------------------------------------
@app.get("/wellness")
async def wellness(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    profile = _profile_dict(await _get_profile(db, identity.user_id))
    res = await db.execute(
        select(HealthEntry)
        .where(HealthEntry.user_id == identity.user_id)
        .order_by(HealthEntry.created_at.desc())
        .limit(10)
    )
    recent = res.scalars().all()
    recent_summary = "; ".join(e.summary for e in recent) if recent else None

    reservation = await authorize(db, identity.user_id, "health_wellness")
    try:
        tips = await brain.wellness_tips(profile=profile, recent_summary=recent_summary)
    except Exception:
        await refund(db, reservation)
        await db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "No se pudo generar recomendaciones.")
    await settle(db, reservation, reservation.amount)
    await db.commit()
    return {"tips": tips}


# ---------------------------------------------------------------------------
# Privacy: wipe all health data for this user
# ---------------------------------------------------------------------------
@app.delete("/data")
async def delete_my_data(identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(HealthEntry).where(HealthEntry.user_id == identity.user_id))
    await db.execute(delete(HealthProfile).where(HealthProfile.user_id == identity.user_id))
    await db.commit()
    return {"deleted": True}
