"""Credit metering engine + tier policy. Server-side source of truth for monetization."""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.models import Tier, UsageEvent, User

# Credit cost per unit of work, by module.
CREDIT_COSTS = {
    "chat": 1,        # per 1k tokens (settled with real usage)
    "code": 2,        # per request
    "image": 5,       # per image
    "video": 200,     # per clip
    "music": 50,      # per track
    "agent": 10,      # per run (base) + per step
    "studio_analyze": 1,      # idea -> metadata
    "studio_storyboard": 5,   # idea -> full scene plan
    "studio_voiceover": 2,    # per narration clip
    "studio_subtitles": 1,    # per subtitle file
    "studio_render": 30,      # per assembled mp4
}

# Tier policy: monthly credit grant + rate limit (requests/min).
TIER_POLICY: dict[Tier, dict] = {
    Tier.free: {"monthly_credits": 100, "rate_limit_per_min": 20, "premium_models": False},
    Tier.pro: {"monthly_credits": 5_000, "rate_limit_per_min": 120, "premium_models": True},
    Tier.business: {"monthly_credits": 30_000, "rate_limit_per_min": 600, "premium_models": True},
}


@dataclass
class Reservation:
    user_id: str
    module: str
    amount: int


async def get_balance(db: AsyncSession, user_id: str) -> int:
    res = await db.execute(select(User.credits).where(User.id == user_id))
    bal = res.scalar_one_or_none()
    if bal is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return bal


async def authorize(db: AsyncSession, user_id: str, module: str, units: int = 1) -> Reservation:
    """Reserve credits before doing work. Raises 402 if insufficient."""
    amount = CREDIT_COSTS.get(module, 1) * units
    balance = await get_balance(db, user_id)
    if balance < amount:
        raise HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED,
            f"Insufficient credits: need {amount}, have {balance}. Upgrade your plan.",
        )
    await db.execute(update(User).where(User.id == user_id).values(credits=User.credits - amount))
    return Reservation(user_id=user_id, module=module, amount=amount)


async def settle(
    db: AsyncSession,
    reservation: Reservation,
    actual_amount: int,
    *,
    tokens: int = 0,
    meta: dict | None = None,
) -> None:
    """Reconcile the reservation against the real cost and log the usage event."""
    delta = reservation.amount - actual_amount  # positive => refund
    if delta:
        await db.execute(
            update(User).where(User.id == reservation.user_id).values(credits=User.credits + delta)
        )
    db.add(
        UsageEvent(
            user_id=reservation.user_id,
            module=reservation.module,
            credits=actual_amount,
            tokens=tokens,
            meta=meta or {},
        )
    )


async def refund(db: AsyncSession, reservation: Reservation) -> None:
    """Full refund on failure."""
    await db.execute(
        update(User).where(User.id == reservation.user_id).values(credits=User.credits + reservation.amount)
    )
