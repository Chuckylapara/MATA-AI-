"""Billing service: tier catalog, Stripe checkout, webhook, credit grants.

Runs in "mock" mode without STRIPE_SECRET_KEY: checkout immediately upgrades the user
and grants credits, so the freemium->premium flow is fully testable offline.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.common.app_factory import create_app
from mata.common.config import settings
from mata.common.credits import TIER_POLICY
from mata.common.db import SessionLocal, get_db
from mata.common.deps import Identity, get_identity
from mata.common.models import Subscription, Tier, User
from mata.common.schemas import CheckoutIn

app = create_app("Billing")

PRICES = {Tier.pro: 2000, Tier.business: 9900}  # cents / month


@app.get("/tiers")
async def tiers():
    return {
        t.value: {
            "price_usd": PRICES.get(t, 0) / 100,
            "monthly_credits": p["monthly_credits"],
            "rate_limit_per_min": p["rate_limit_per_min"],
            "premium_models": p["premium_models"],
        }
        for t, p in TIER_POLICY.items()
    }


async def _apply_tier(db: AsyncSession, user_id: str, tier: Tier) -> None:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one()
    user.tier = tier
    user.credits = TIER_POLICY[tier]["monthly_credits"]
    sub = (await db.execute(select(Subscription).where(Subscription.user_id == user_id))).scalar_one_or_none()
    if sub is None:
        sub = Subscription(user_id=user_id)
        db.add(sub)
    sub.tier = tier
    sub.status = "active"


@app.post("/checkout")
async def checkout(body: CheckoutIn, identity: Identity = Depends(get_identity), db: AsyncSession = Depends(get_db)):
    tier = Tier(body.tier)

    if not settings.stripe_secret_key:
        # Mock mode: upgrade immediately.
        await _apply_tier(db, identity.user_id, tier)
        return {"mode": "mock", "tier": tier.value, "status": "upgraded", "checkout_url": None}

    import stripe

    stripe.api_key = settings.stripe_secret_key
    user = (await db.execute(select(User).where(User.id == identity.user_id))).scalar_one()
    if not user.stripe_customer_id:
        customer = stripe.Customer.create(email=user.email)
        user.stripe_customer_id = customer.id
    sess = stripe.checkout.Session.create(
        customer=user.stripe_customer_id,
        mode="subscription",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": f"Mata AI {tier.value.title()}"},
                "unit_amount": PRICES[tier],
                "recurring": {"interval": "month"},
            },
            "quantity": 1,
        }],
        metadata={"user_id": identity.user_id, "tier": tier.value},
        success_url="http://localhost:3000/billing?status=success",
        cancel_url="http://localhost:3000/billing?status=cancel",
    )
    return {"mode": "stripe", "checkout_url": sess.url}


@app.post("/webhook")
async def webhook(request: Request):
    import stripe

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, sig, settings.stripe_webhook_secret)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid webhook: {exc}")

    if event["type"] == "checkout.session.completed":
        meta = event["data"]["object"]["metadata"]
        async with SessionLocal() as db:
            await _apply_tier(db, meta["user_id"], Tier(meta["tier"]))
            await db.commit()
    elif event["type"] == "customer.subscription.deleted":
        sub_id = event["data"]["object"]["id"]
        async with SessionLocal() as db:
            sub = (await db.execute(select(Subscription).where(Subscription.stripe_subscription_id == sub_id))).scalar_one_or_none()
            if sub:
                await _apply_tier(db, sub.user_id, Tier.free)
                await db.commit()
    return {"received": True}
