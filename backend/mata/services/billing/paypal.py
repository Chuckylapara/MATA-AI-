"""PayPal REST client: OAuth, subscriptions, one-time orders, webhook verification.

Thin async wrapper over the PayPal REST API (httpx). Credentials come from settings
(PAYPAL_CLIENT_ID / PAYPAL_SECRET); the env (sandbox vs live) selects the API base.
Nothing here is called unless PayPal is configured, so the platform runs fine without it.
"""
from __future__ import annotations

import httpx

from mata.common.config import settings
from mata.common.credits import CREDIT_PACKS, TIER_POLICY
from mata.common.models import Tier


class PayPalError(RuntimeError):
    pass


def _require_config() -> None:
    if not settings.paypal_enabled:
        raise PayPalError("PayPal no está configurado (faltan PAYPAL_CLIENT_ID / PAYPAL_SECRET).")


async def _access_token(client: httpx.AsyncClient) -> str:
    resp = await client.post(
        f"{settings.paypal_api_base}/v1/oauth2/token",
        auth=(settings.paypal_client_id, settings.paypal_secret),
        data={"grant_type": "client_credentials"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if resp.status_code != 200:
        raise PayPalError("No se pudo autenticar con PayPal (revisa las credenciales).")
    return resp.json()["access_token"]


def _approval_url(links: list[dict]) -> str | None:
    for link in links or []:
        if link.get("rel") == "approve":
            return link.get("href")
    return None


def plan_id_for_tier(tier: Tier) -> str | None:
    return {Tier.pro: settings.paypal_plan_pro, Tier.business: settings.paypal_plan_business}.get(tier)


def tier_for_plan_id(plan_id: str) -> Tier | None:
    mapping = {settings.paypal_plan_pro: Tier.pro, settings.paypal_plan_business: Tier.business}
    return mapping.get(plan_id)


async def create_subscription(tier: Tier, user_id: str) -> dict:
    """Create a recurring subscription; returns {subscription_id, approval_url}."""
    _require_config()
    plan_id = plan_id_for_tier(tier)
    if not plan_id:
        raise PayPalError(
            f"No hay plan de PayPal para '{tier.value}'. Ejecuta scripts/paypal_setup.py "
            "y pon los IDs en .env (PAYPAL_PLAN_PRO / PAYPAL_PLAN_BUSINESS)."
        )
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _access_token(client)
        resp = await client.post(
            f"{settings.paypal_api_base}/v1/billing/subscriptions",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "plan_id": plan_id,
                "custom_id": user_id,
                "application_context": {
                    "brand_name": "Mata AI",
                    "user_action": "SUBSCRIBE_NOW",
                    "return_url": f"{settings.public_app_url}/billing?status=success&kind=sub",
                    "cancel_url": f"{settings.public_app_url}/billing?status=cancel",
                },
            },
        )
        if resp.status_code not in (200, 201):
            raise PayPalError("PayPal rechazó la creación de la suscripción.")
        data = resp.json()
        return {"subscription_id": data.get("id"), "approval_url": _approval_url(data.get("links", []))}


async def create_order(pack: str, user_id: str) -> dict:
    """Create a one-time order for a credit pack; returns {order_id, approval_url}."""
    _require_config()
    spec = CREDIT_PACKS[pack]
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _access_token(client)
        resp = await client.post(
            f"{settings.paypal_api_base}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "intent": "CAPTURE",
                "purchase_units": [{
                    "amount": {"currency_code": "USD", "value": f"{spec['price_usd']:.2f}"},
                    "custom_id": f"{user_id}:{pack}",
                    "description": f"Mata AI — {spec['credits']} créditos",
                }],
                "application_context": {
                    "brand_name": "Mata AI",
                    "user_action": "PAY_NOW",
                    "return_url": f"{settings.public_app_url}/billing?status=success&kind=pack",
                    "cancel_url": f"{settings.public_app_url}/billing?status=cancel",
                },
            },
        )
        if resp.status_code not in (200, 201):
            raise PayPalError("PayPal rechazó la creación de la orden.")
        data = resp.json()
        return {"order_id": data.get("id"), "approval_url": _approval_url(data.get("links", []))}


async def capture_order(order_id: str) -> dict:
    """Capture an approved order. Returns {status, user_id, pack} on completion."""
    _require_config()
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _access_token(client)
        resp = await client.post(
            f"{settings.paypal_api_base}/v2/checkout/orders/{order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        if resp.status_code not in (200, 201):
            raise PayPalError("No se pudo capturar el pago en PayPal.")
        data = resp.json()
        if data.get("status") != "COMPLETED":
            return {"status": data.get("status"), "user_id": None, "pack": None}
        custom = data["purchase_units"][0]["payments"]["captures"][0].get("custom_id", "")
        user_id, _, pack = custom.partition(":")
        return {"status": "COMPLETED", "user_id": user_id or None, "pack": pack or None}


async def get_subscription(subscription_id: str) -> dict:
    """Fetch a subscription's current state: {status, user_id, tier}."""
    _require_config()
    async with httpx.AsyncClient(timeout=30) as client:
        token = await _access_token(client)
        resp = await client.get(
            f"{settings.paypal_api_base}/v1/billing/subscriptions/{subscription_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200:
            raise PayPalError("No se pudo consultar la suscripción en PayPal.")
        data = resp.json()
        return {
            "status": data.get("status"),
            "user_id": data.get("custom_id"),
            "tier": tier_for_plan_id(data.get("plan_id", "")),
        }


async def verify_webhook(headers: dict, body: bytes) -> bool:
    """Verify a webhook event's authenticity with PayPal. Requires PAYPAL_WEBHOOK_ID."""
    if not settings.paypal_webhook_id:
        return False
    import json

    async with httpx.AsyncClient(timeout=30) as client:
        token = await _access_token(client)
        resp = await client.post(
            f"{settings.paypal_api_base}/v1/notifications/verify-webhook-signature",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "auth_algo": headers.get("paypal-auth-algo"),
                "cert_url": headers.get("paypal-cert-url"),
                "transmission_id": headers.get("paypal-transmission-id"),
                "transmission_sig": headers.get("paypal-transmission-sig"),
                "transmission_time": headers.get("paypal-transmission-time"),
                "webhook_id": settings.paypal_webhook_id,
                "webhook_event": json.loads(body),
            },
        )
        return resp.status_code == 200 and resp.json().get("verification_status") == "SUCCESS"
