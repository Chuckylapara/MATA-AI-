"""One-time setup: create the PayPal product + monthly billing plans for Mata AI.

Run this once after putting PAYPAL_CLIENT_ID / PAYPAL_SECRET (and PAYPAL_ENV) in
backend/.env. It prints the two plan IDs — paste them back into .env as
PAYPAL_PLAN_PRO and PAYPAL_PLAN_BUSINESS, then restart the backend.

    cd backend
    python -m scripts.paypal_setup
"""
from __future__ import annotations

import asyncio
import sys

import httpx

# Allow running from the backend/ directory.
sys.path.insert(0, ".")

from mata.common.config import settings  # noqa: E402

PLANS = [
    {"key": "PAYPAL_PLAN_PRO", "name": "Mata AI Pro", "price": "20.00"},
    {"key": "PAYPAL_PLAN_BUSINESS", "name": "Mata AI Business", "price": "99.00"},
]


async def main() -> None:
    if not settings.paypal_enabled:
        print("✗ Faltan PAYPAL_CLIENT_ID / PAYPAL_SECRET en backend/.env")
        return
    base = settings.paypal_api_base
    print(f"Usando PayPal en modo: {settings.paypal_env}  ({base})")

    async with httpx.AsyncClient(timeout=30) as client:
        tok = (await client.post(
            f"{base}/v1/oauth2/token",
            auth=(settings.paypal_client_id, settings.paypal_secret),
            data={"grant_type": "client_credentials"},
        )).json()["access_token"]
        H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

        # 1) Product
        prod = await client.post(f"{base}/v1/catalogs/products", headers=H, json={
            "name": "Mata AI", "type": "SERVICE", "category": "SOFTWARE",
        })
        product_id = prod.json()["id"]
        print(f"✓ Producto creado: {product_id}\n")

        # 2) Plans
        results = []
        for p in PLANS:
            plan = await client.post(f"{base}/v1/billing/plans", headers=H, json={
                "product_id": product_id,
                "name": p["name"],
                "billing_cycles": [{
                    "frequency": {"interval_unit": "MONTH", "interval_count": 1},
                    "tenure_type": "REGULAR", "sequence": 1, "total_cycles": 0,
                    "pricing_scheme": {"fixed_price": {"value": p["price"], "currency_code": "USD"}},
                }],
                "payment_preferences": {
                    "auto_bill_outstanding": True,
                    "setup_fee_failure_action": "CONTINUE",
                    "payment_failure_threshold": 1,
                },
            })
            plan_id = plan.json().get("id")
            results.append((p["key"], plan_id))
            print(f"✓ {p['name']}: {plan_id}")

    print("\n── Pega estas líneas en backend/.env y reinicia el backend: ──")
    for key, plan_id in results:
        print(f"{key}={plan_id}")


if __name__ == "__main__":
    asyncio.run(main())
