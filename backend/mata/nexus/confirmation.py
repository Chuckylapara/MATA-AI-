"""Confirmation engine: classifies actions by risk and decides run / confirm / deny.

LOW    search, read, calculate, summarise            → run (if permitted)
MEDIUM drafts, file edits, scheduling                → run if ALLOW, confirm if ASK
HIGH   send, publish, purchase, delete, account/$$   → always confirm, unless the user
       created an explicit trusted-automation rule that matches — and never when the
       current turn consumed untrusted external content, and never for purchases.
"""
from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.models import NexusPendingAction, NexusTrustedRule, PendingStatus, Risk
from mata.nexus.permissions import Decision

PENDING_TTL = timedelta(minutes=10)
#: tools that no trusted rule may ever cover
NEVER_TRUSTED = {"shopping_purchase"}


class Verdict(str, enum.Enum):
    run = "run"
    confirm = "confirm"
    deny = "deny"


@dataclass
class GateResult:
    verdict: Verdict
    reason: str


def rule_matches(rule: NexusTrustedRule, tool: str, args: dict) -> bool:
    if not rule.enabled or rule.tool != tool:
        return False
    for key, expected in (rule.constraints or {}).items():
        actual = args.get(key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        elif str(actual).strip().lower() != str(expected).strip().lower():
            return False
    return True


async def matching_rule(db: AsyncSession, user_id: str, tool: str, args: dict) -> NexusTrustedRule | None:
    res = await db.execute(select(NexusTrustedRule).where(
        NexusTrustedRule.user_id == user_id, NexusTrustedRule.tool == tool, NexusTrustedRule.enabled.is_(True)))
    for rule in res.scalars():
        if rule_matches(rule, tool, args):
            return rule
    return None


def gate(*, risk: Risk, permission: Decision, has_trusted_rule: bool, tainted: bool, tool: str) -> GateResult:
    if permission == Decision.deny:
        return GateResult(Verdict.deny, "Permission denied in your settings.")
    if risk == Risk.high:
        if has_trusted_rule and not tainted and tool not in NEVER_TRUSTED and permission == Decision.allow:
            return GateResult(Verdict.run, "Covered by your trusted automation rule.")
        if tainted:
            return GateResult(Verdict.confirm, "High-risk action requested after reading external content.")
        return GateResult(Verdict.confirm, "High-risk action requires your confirmation.")
    if permission == Decision.ask:
        return GateResult(Verdict.confirm, "This capability is set to 'Ask'.")
    return GateResult(Verdict.run, "Allowed.")


async def create_pending(db: AsyncSession, *, user_id: str, tool: str, args: dict, risk: Risk,
                         preview: dict, reason: str) -> NexusPendingAction:
    pa = NexusPendingAction(user_id=user_id, tool=tool, args=args, risk=risk, preview=preview, reason=reason,
                            expires_at=datetime.now(timezone.utc) + PENDING_TTL)
    db.add(pa)
    await db.flush()
    return pa


def is_expired(pa: NexusPendingAction) -> bool:
    exp = pa.expires_at if pa.expires_at.tzinfo else pa.expires_at.replace(tzinfo=timezone.utc)
    return exp < datetime.now(timezone.utc)


async def load_pending(db: AsyncSession, user_id: str, action_id: str) -> NexusPendingAction | None:
    res = await db.execute(select(NexusPendingAction).where(
        NexusPendingAction.id == action_id, NexusPendingAction.user_id == user_id))
    pa = res.scalar_one_or_none()
    if pa and pa.status == PendingStatus.pending and is_expired(pa):
        pa.status = PendingStatus.expired
        await db.flush()
    return pa
