"""Central permission manager.

Each capability has a mode: ALLOW, DENY, ASK, TEMPORARY (allow until expiry) or
TRUSTED (trusted automation). Users can change or revoke any of them at any time.
Camera and microphone are additionally gated by the browser's own permission
prompt — the server setting can only restrict, never silently enable, them.
"""
from __future__ import annotations

import enum
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.models import NexusPermission, PermissionMode


class Capability(str, enum.Enum):
    MICROPHONE = "MICROPHONE"
    CAMERA = "CAMERA"
    LOCATION = "LOCATION"
    CONTACTS = "CONTACTS"
    FILES = "FILES"
    EMAIL = "EMAIL"
    CALENDAR = "CALENDAR"
    SOCIAL = "SOCIAL"
    BROWSER = "BROWSER"
    SHOPPING = "SHOPPING"
    MESSAGING = "MESSAGING"
    CODE_EXECUTION = "CODE_EXECUTION"
    WEB = "WEB"          # search + read public pages
    MEMORY = "MEMORY"    # read/write long-term memory
    TASKS = "TASKS"      # create scheduled tasks/reminders


DEFAULTS: dict[Capability, PermissionMode] = {
    Capability.WEB: PermissionMode.allow,
    Capability.MEMORY: PermissionMode.allow,
    Capability.TASKS: PermissionMode.allow,
    **{c: PermissionMode.ask for c in Capability if c not in (Capability.WEB, Capability.MEMORY, Capability.TASKS)},
}

DESCRIPTIONS: dict[Capability, str] = {
    Capability.MICROPHONE: "Listen through your microphone (only while the MIC indicator is on).",
    Capability.CAMERA: "See through your camera (only while the CAM indicator is on).",
    Capability.LOCATION: "Use your approximate location.",
    Capability.CONTACTS: "Read your contacts to find recipients.",
    Capability.FILES: "Read and organise files you share.",
    Capability.EMAIL: "Read, draft and send email.",
    Capability.CALENDAR: "Read and change your calendar.",
    Capability.SOCIAL: "Manage connected social accounts.",
    Capability.BROWSER: "Automate a browser on permitted websites.",
    Capability.SHOPPING: "Search products, manage carts and purchase (purchases always confirmed).",
    Capability.MESSAGING: "Draft and send messages.",
    Capability.CODE_EXECUTION: "Run code in a sandbox.",
    Capability.WEB: "Search the web and read public pages.",
    Capability.MEMORY: "Remember things about you and your projects.",
    Capability.TASKS: "Create reminders and scheduled tasks.",
}


class Decision(str, enum.Enum):
    allow = "allow"
    deny = "deny"
    ask = "ask"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


class PermissionManager:
    def __init__(self, db: AsyncSession, user_id: str) -> None:
        self.db = db
        self.user_id = user_id

    async def _row(self, cap: Capability) -> NexusPermission | None:
        res = await self.db.execute(select(NexusPermission).where(
            NexusPermission.user_id == self.user_id, NexusPermission.capability == cap.value))
        return res.scalar_one_or_none()

    async def mode(self, cap: Capability) -> tuple[PermissionMode, datetime | None]:
        row = await self._row(cap)
        if row is None:
            return DEFAULTS[cap], None
        return row.mode, _aware(row.expires_at)

    async def check(self, cap: Capability | str | None) -> Decision:
        if cap is None:
            return Decision.allow
        cap = Capability(cap)
        mode, expires = await self.mode(cap)
        if mode in (PermissionMode.allow, PermissionMode.trusted):
            return Decision.allow
        if mode == PermissionMode.deny:
            return Decision.deny
        if mode == PermissionMode.temporary:
            return Decision.allow if expires and expires > _now() else Decision.ask
        return Decision.ask

    async def is_trusted(self, cap: Capability | str | None) -> bool:
        if cap is None:
            return False
        mode, _ = await self.mode(Capability(cap))
        return mode == PermissionMode.trusted

    async def set(self, cap: Capability | str, mode: PermissionMode, minutes: int | None = None) -> NexusPermission:
        cap = Capability(cap)
        row = await self._row(cap)
        expires = _now() + timedelta(minutes=minutes or 60) if mode == PermissionMode.temporary else None
        if row is None:
            row = NexusPermission(user_id=self.user_id, capability=cap.value, mode=mode, expires_at=expires)
            self.db.add(row)
        else:
            row.mode, row.expires_at = mode, expires
        await self.db.flush()
        return row

    async def list(self) -> list[dict]:
        res = await self.db.execute(select(NexusPermission).where(NexusPermission.user_id == self.user_id))
        rows = {r.capability: r for r in res.scalars()}
        out = []
        for cap in Capability:
            r = rows.get(cap.value)
            mode = r.mode if r else DEFAULTS[cap]
            expires = _aware(r.expires_at) if r else None
            effective = await self.check(cap)
            out.append({"capability": cap.value, "mode": mode.value, "effective": effective.value,
                        "expires_at": expires.isoformat() if expires else None,
                        "description": DESCRIPTIONS[cap], "default": DEFAULTS[cap].value})
        return out
