"""Audit log + human-readable action feed. Every autonomous action is recorded."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.models import NexusActionEvent, NexusAuditLog
from mata.nexus.security import redact_secrets


async def audit(
    db: AsyncSession, *, user_id: str | None, actor: str, action: str, outcome: str,
    target: str | None = None, risk: str | None = None, data: dict | None = None,
) -> None:
    db.add(NexusAuditLog(
        user_id=user_id, actor=actor, action=action, target=(target or "")[:200] or None, risk=risk,
        outcome=outcome, data=redact_secrets(data or {}),
    ))
    await db.flush()


async def feed(db: AsyncSession, *, user_id: str, kind: str, message: str, data: dict | None = None) -> NexusActionEvent:
    ev = NexusActionEvent(user_id=user_id, kind=kind, message=redact_secrets(message)[:500],
                          data=redact_secrets(data or {}))
    db.add(ev)
    await db.flush()
    return ev
