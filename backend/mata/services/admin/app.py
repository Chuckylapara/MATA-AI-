"""Admin service: platform metrics, user management, usage analytics.

All routes require the 'admin' role (enforced again here as defense-in-depth;
the gateway already blocks non-admins from /admin/*).
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.db import get_db
from mata.common.deps import Identity, require_role
from mata.common.models import Generation, Tier, UsageEvent, User
from mata.services.billing.app import PRICES

app = create_app("Admin")
admin_only = require_role("admin")


@app.get("/overview")
async def overview(_: Identity = Depends(admin_only), db: AsyncSession = Depends(get_db)):
    total_users = (await db.execute(select(func.count(User.id)))).scalar_one()
    by_tier = {
        t.value: (await db.execute(select(func.count(User.id)).where(User.tier == t))).scalar_one()
        for t in Tier
    }
    total_credits_spent = (await db.execute(select(func.coalesce(func.sum(UsageEvent.credits), 0)))).scalar_one()
    usage_by_module = dict(
        (await db.execute(select(UsageEvent.module, func.sum(UsageEvent.credits)).group_by(UsageEvent.module))).all()
    )
    total_generations = (await db.execute(select(func.count(Generation.id)))).scalar_one()

    # Naive MRR from current paid tiers.
    mrr_cents = sum(by_tier.get(t.value, 0) * PRICES.get(t, 0) for t in Tier)

    return {
        "total_users": total_users,
        "users_by_tier": by_tier,
        "total_credits_spent": total_credits_spent,
        "credits_by_module": {k: int(v) for k, v in usage_by_module.items()},
        "total_generations": total_generations,
        "mrr_usd": mrr_cents / 100,
    }


@app.get("/users")
async def list_users(_: Identity = Depends(admin_only), db: AsyncSession = Depends(get_db), limit: int = 100):
    res = await db.execute(select(User).order_by(User.created_at.desc()).limit(limit))
    return [
        {"id": u.id, "email": u.email, "role": u.role.value, "tier": u.tier.value, "credits": u.credits, "is_active": u.is_active}
        for u in res.scalars()
    ]


@app.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    tier: str | None = None,
    credits: int | None = None,
    is_active: bool | None = None,
    _: Identity = Depends(admin_only),
    db: AsyncSession = Depends(get_db),
):
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if tier is not None:
        user.tier = Tier(tier)
    if credits is not None:
        user.credits = credits
    if is_active is not None:
        user.is_active = is_active
    return {"id": user.id, "tier": user.tier.value, "credits": user.credits, "is_active": user.is_active}


@app.get("/usage")
async def usage(_: Identity = Depends(admin_only), db: AsyncSession = Depends(get_db), limit: int = 100):
    res = await db.execute(select(UsageEvent).order_by(UsageEvent.created_at.desc()).limit(limit))
    return [
        {"user_id": e.user_id, "module": e.module, "credits": e.credits, "tokens": e.tokens, "at": e.created_at}
        for e in res.scalars()
    ]
