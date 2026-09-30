"""Standard tool interface + the executor that enforces permissions, risk and audit."""
from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.audit import audit, feed
from mata.nexus.confirmation import Verdict, create_pending, gate, matching_rule
from mata.nexus.events import EventName, bus
from mata.nexus.models import Risk
from mata.nexus.permissions import Capability, PermissionManager
from mata.nexus.security import MAX_TOOL_ARGS_CHARS, redact_secrets

if TYPE_CHECKING:
    from mata.nexus.memory import MemoryEngine
    from mata.nexus.router import ModelRouter

log = logging.getLogger("nexus.tools")


@dataclass
class ToolResult:
    ok: bool
    data: Any = None
    error: str | None = None
    error_code: str | None = None      # integration_not_configured | permission_denied | timeout | invalid_input | failed
    setup: list[str] | None = None     # how to configure a missing integration
    pending_action_id: str | None = None
    preview: dict | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class ToolContext:
    db: AsyncSession
    user_id: str
    router: "ModelRouter"
    memory: "MemoryEngine"
    memory_enabled: bool = True
    #: set once the turn has consumed untrusted external content
    tainted: bool = False
    emit: Callable[[str, dict], Awaitable[None]] | None = None

    async def event(self, name: str, data: dict) -> None:
        if self.emit:
            await self.emit(name, data)


Handler = Callable[..., Awaitable[ToolResult]]


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict
    handler: Handler
    output_schema: dict = field(default_factory=lambda: {"type": "object"})
    permission: Capability | None = None
    risk: Risk = Risk.low
    timeout_s: float = 30.0
    integration: str | None = None
    untrusted_output: bool = False
    #: builds the human-readable confirmation preview for HIGH/ASK actions
    preview: Callable[[dict], dict] | None = None
    category: str = "general"

    @property
    def confirmation_required(self) -> bool:
        return self.risk == Risk.high

    def spec(self) -> dict:
        return {
            "name": self.name, "description": self.description, "input_schema": self.input_schema,
            "output_schema": self.output_schema, "permission": self.permission.value if self.permission else None,
            "risk": self.risk.value, "confirmation_required": self.confirmation_required,
            "timeout_s": self.timeout_s, "integration": self.integration, "category": self.category,
        }


# ---------------------------------------------------------------------------
# Minimal JSON-schema validation (object/required/type/enum/maxLength/min/max)
# ---------------------------------------------------------------------------
_TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "object": dict, "array": list}


def validate(schema: dict, args: Any) -> list[str]:
    errors: list[str] = []
    if schema.get("type") == "object":
        if not isinstance(args, dict):
            return ["arguments must be an object"]
        for key in schema.get("required", []):
            if key not in args or args[key] in (None, ""):
                errors.append(f"missing required field '{key}'")
        props = schema.get("properties", {})
        for key, val in args.items():
            if key not in props:
                if schema.get("additionalProperties") is False:
                    errors.append(f"unexpected field '{key}'")
                continue
            p = props[key]
            t = p.get("type")
            if t and val is not None:
                py = _TYPES.get(t)
                if py and (not isinstance(val, py) or (t in ("integer", "number") and isinstance(val, bool))):
                    errors.append(f"'{key}' must be {t}")
                    continue
            if "enum" in p and val not in p["enum"]:
                errors.append(f"'{key}' must be one of {p['enum']}")
            if isinstance(val, str) and "maxLength" in p and len(val) > p["maxLength"]:
                errors.append(f"'{key}' too long (max {p['maxLength']})")
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                if "minimum" in p and val < p["minimum"]:
                    errors.append(f"'{key}' below minimum {p['minimum']}")
                if "maximum" in p and val > p["maximum"]:
                    errors.append(f"'{key}' above maximum {p['maximum']}")
    return errors


class ToolExecutor:
    """lookup → integration → permission → validation → risk gate → run(timeout) → audit."""

    def __init__(self, registry: "ToolRegistryLike") -> None:
        self.registry = registry

    async def run(self, ctx: ToolContext, name: str, args: dict | None, *, confirmed: bool = False,
                  actor: str = "nexus") -> ToolResult:
        args = args or {}
        tool = self.registry.get(name)
        if tool is None:
            return ToolResult(False, error=f"Unknown tool '{name}'", error_code="unknown_tool")

        if tool.integration:
            from mata.nexus.integrations import integration_status

            st = integration_status(tool.integration)
            if not st["configured"]:
                await feed(ctx.db, user_id=ctx.user_id, kind="integration",
                           message=f"{st['name']}: integration not configured")
                return ToolResult(False, error=f"Integration '{st['name']}' not configured.",
                                  error_code="integration_not_configured", setup=st["setup"])

        if len(json.dumps(args, default=str)) > MAX_TOOL_ARGS_CHARS:
            return ToolResult(False, error="Arguments too large", error_code="invalid_input")
        errors = validate(tool.input_schema, args)
        if errors:
            return ToolResult(False, error="; ".join(errors), error_code="invalid_input")

        perms = PermissionManager(ctx.db, ctx.user_id)
        decision = await perms.check(tool.permission)
        if not confirmed:
            rule = None
            if tool.risk == Risk.high:
                rule = await matching_rule(ctx.db, ctx.user_id, tool.name, args)
            result = gate(risk=tool.risk, permission=decision, has_trusted_rule=rule is not None,
                          tainted=ctx.tainted, tool=tool.name)
            if result.verdict == Verdict.deny:
                await audit(ctx.db, user_id=ctx.user_id, actor=actor, action=f"tool:{tool.name}", outcome="denied",
                            risk=tool.risk.value, data={"args": args, "reason": result.reason})
                return ToolResult(False, error=result.reason, error_code="permission_denied")
            if result.verdict == Verdict.confirm:
                preview = tool.preview(args) if tool.preview else {"tool": tool.name, "args": args}
                pa = await create_pending(ctx.db, user_id=ctx.user_id, tool=tool.name, args=args, risk=tool.risk,
                                          preview=preview, reason=result.reason)
                await audit(ctx.db, user_id=ctx.user_id, actor=actor, action=f"tool:{tool.name}", outcome="pending",
                            risk=tool.risk.value, target=pa.id, data={"args": args, "reason": result.reason})
                await feed(ctx.db, user_id=ctx.user_id, kind="confirmation",
                           message=f"Waiting for confirmation: {tool.name}", data={"pending_action_id": pa.id})
                await bus.publish(EventName.CONFIRMATION_REQUIRED, ctx.user_id, tool=tool.name, action_id=pa.id)
                return ToolResult(False, error=result.reason, error_code="confirmation_required",
                                  pending_action_id=pa.id, preview=preview)
        elif decision.value == "deny":
            return ToolResult(False, error="Permission denied in your settings.", error_code="permission_denied")

        await bus.publish(EventName.TOOL_STARTED, ctx.user_id, tool=tool.name)
        await ctx.event("tool", {"tool": tool.name, "status": "started", "category": tool.category})
        try:
            res = await asyncio.wait_for(tool.handler(ctx, **args), timeout=tool.timeout_s)
        except asyncio.TimeoutError:
            res = ToolResult(False, error=f"{tool.name} timed out after {tool.timeout_s:.0f}s", error_code="timeout")
        except Exception as exc:  # noqa: BLE001 — a tool failure must never crash the turn
            log.exception("tool %s failed", tool.name)
            res = ToolResult(False, error=f"{tool.name} failed: {exc}", error_code="failed")

        if res.ok and tool.untrusted_output:
            ctx.tainted = True
        outcome = "ok" if res.ok else "failed"
        await bus.publish(EventName.TOOL_COMPLETED if res.ok else EventName.TOOL_FAILED, ctx.user_id,
                          tool=tool.name, error=res.error)
        await ctx.event("tool", {"tool": tool.name, "status": "completed" if res.ok else "failed",
                                 "error": res.error, "category": tool.category})
        await audit(ctx.db, user_id=ctx.user_id, actor=actor, action=f"tool:{tool.name}", outcome=outcome,
                    risk=tool.risk.value, data={"args": args, "error": res.error, "confirmed": confirmed})
        return res


class ToolRegistryLike:  # typing helper
    def get(self, name: str) -> Tool | None: ...  # pragma: no cover


def summarize_for_model(res: ToolResult, limit: int = 3500) -> str:
    return json.dumps(redact_secrets(res.to_dict()), ensure_ascii=False, default=str)[:limit]
