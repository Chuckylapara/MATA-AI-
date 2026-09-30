"""Orchestrator: one conversational turn → context → plan → tools → streamed answer.

Yields (event_name, data) tuples that the HTTP layer turns into SSE:
  state · token · tool · agent · memory · confirmation_required · error · done
"""
from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from mata.common.config import settings
from mata.nexus.audit import feed
from mata.nexus.events import EventName, bus
from mata.nexus.memory import MemoryRejected, extract_facts, serialize
from mata.nexus.models import NexusProfile
from mata.nexus.persona import build_system_prompt
from mata.nexus.providers.base import ProviderError
from mata.nexus.security import clamp, scan_injection
from mata.nexus.tools.base import ToolContext, summarize_for_model
from mata.nexus.tools.registry import executor, registry

log = logging.getLogger("nexus.orchestrator")

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "reply": {"type": "string", "description": "Final spoken answer when no tool is needed"},
        "tool_calls": {"type": "array", "items": {"type": "object", "properties": {
            "tool": {"type": "string"}, "args": {"type": "object"}}, "required": ["tool", "args"]}},
    },
}

PLAN_INSTRUCTIONS = (
    "Decide the next step. If you can answer now, return {\"reply\": \"...\"} with the natural spoken answer. "
    "If you need information or must act, return {\"tool_calls\": [{\"tool\": name, \"args\": {...}}]} using "
    "ONLY the listed tools. Prefer research_topic for 'find everything about X' requests, web_search for quick "
    "facts, memory_search when the user refers to past context ('what were we doing with my company?'). "
    "Use email_draft for 'write an email', email_send only when the user explicitly says send. Never invent "
    "tool results."
)

FINAL_INSTRUCTIONS = (
    "Now answer the user naturally and concisely based on the tool results above. Cite web sources by name or "
    "domain when you use them. If a tool failed or an integration is not configured, say exactly what failed and "
    "what is needed. If an action is waiting for confirmation, say so and describe it — do not claim it is done."
)


@dataclass
class TurnState:
    tool_results: list[dict] = field(default_factory=list)
    pending: list[dict] = field(default_factory=list)
    provider: str | None = None


def _tool_lines() -> list[str]:
    lines = []
    for t in registry.available():
        props = ", ".join(t.input_schema.get("properties", {}).keys())
        lines.append(f"- {t.name}({props}): {t.description} [risk={t.risk.value}]")
    return lines


def _now_for(tz: str) -> str:
    try:
        return datetime.now(ZoneInfo(tz)).isoformat(timespec="minutes")
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).isoformat(timespec="minutes")


async def run_turn(ctx: ToolContext, profile: NexusProfile, text: str,
                   history: list[dict]) -> AsyncIterator[tuple[str, dict]]:
    text = clamp(text)
    turn = TurnState()
    await bus.publish(EventName.USER_SPOKE, ctx.user_id, chars=len(text))
    yield "state", {"state": "THINKING"}

    # 1) Context: relevant memories (never the full history).
    memory_lines: list[str] = []
    if ctx.memory_enabled:
        found = await ctx.memory.search(text, k=6)
        memory_lines = [f"[{r.memory.type.value}] {r.memory.content}" for r in found]
        if found:
            await bus.publish(EventName.MEMORY_RETRIEVED, ctx.user_id, count=len(found))
            yield "memory", {"action": "retrieved", "count": len(found),
                             "items": [{"id": r.memory.id, "content": r.memory.content, "score": r.score}
                                       for r in found]}

    name = profile.display_name
    system = build_system_prompt(name=name, language=profile.language, memories=memory_lines,
                                 tool_lines=_tool_lines(), now_iso=_now_for(profile.timezone),
                                 timezone=profile.timezone)
    if scan_injection(text).suspicious:
        log.info("user message contains instruction-override phrasing (allowed: it's the user's own message)")

    messages: list[dict] = [*history[-12:], {"role": "user", "content": text}]

    # 2) Plan / act loop.
    final_reply: str | None = None
    try:
        for _step in range(settings.nexus_max_steps):
            plan, turn.provider = await ctx.router.structured(
                messages, PLAN_SCHEMA, system=f"{system}\n\n{PLAN_INSTRUCTIONS}", role="reasoning",
                user_id=ctx.user_id)
            calls = [c for c in (plan.get("tool_calls") or []) if isinstance(c, dict) and c.get("tool")][:4]
            if not calls:
                final_reply = (plan.get("reply") or "").strip() or None
                break
            results_text = []
            for call in calls:
                name_ = str(call["tool"])
                args = call.get("args") if isinstance(call.get("args"), dict) else {}
                yield "state", {"state": "WORKING" if name_ not in ("web_search", "research_topic") else "SEARCHING"}
                await feed(ctx.db, user_id=ctx.user_id, kind="tool", message=f"Running {name_}…", data={"args": args})
                res = await executor.run(ctx, name_, args)
                entry = {"tool": name_, "args": args, **res.to_dict()}
                turn.tool_results.append(entry)
                if res.error_code == "confirmation_required":
                    turn.pending.append({"action_id": res.pending_action_id, "tool": name_, "preview": res.preview,
                                         "reason": res.error})
                    yield "confirmation_required", turn.pending[-1]
                    yield "state", {"state": "WARNING"}
                elif not res.ok:
                    await feed(ctx.db, user_id=ctx.user_id, kind="tool_failed", message=f"{name_} failed: {res.error}")
                else:
                    await feed(ctx.db, user_id=ctx.user_id, kind="tool_ok", message=f"{name_} completed")
                results_text.append(f"{name_}: {summarize_for_model(res)}")
            messages = [*messages, {"role": "assistant", "content": json.dumps({"tool_calls": calls})},
                        {"role": "user", "content": "TOOL RESULTS\n" + "\n".join(results_text)}]
            if turn.pending:
                break  # stop acting until the user confirms
    except ProviderError as exc:
        yield "state", {"state": "ERROR"}
        yield "error", {"code": "provider_unavailable",
                        "message": f"No AI provider could answer: {exc}. Check System Health for configuration."}
        return

    # 3) Answer (stream).
    yield "state", {"state": "SPEAKING"}
    reply_parts: list[str] = []
    try:
        if final_reply and not turn.tool_results:
            for i in range(0, len(final_reply), 24):
                chunk = final_reply[i:i + 24]
                reply_parts.append(chunk)
                yield "token", {"text": chunk}
        else:
            async for chunk in ctx.router.stream(messages, system=f"{system}\n\n{FINAL_INSTRUCTIONS}",
                                                 role="reasoning", user_id=ctx.user_id, max_tokens=1200):
                reply_parts.append(chunk)
                yield "token", {"text": chunk}
    except ProviderError as exc:
        yield "state", {"state": "ERROR"}
        yield "error", {"code": "provider_unavailable", "message": str(exc)}
        return
    reply = "".join(reply_parts).strip()

    # 4) Post-turn memory extraction (rule-based; user's own words only).
    if ctx.memory_enabled:
        for fact in extract_facts(text):
            try:
                mem, created = await ctx.memory.write(fact.content, type=fact.type, importance=fact.importance,
                                                      source="extracted")
            except MemoryRejected:
                continue
            if fact.profile_name and profile.display_name != fact.profile_name:
                profile.display_name = fact.profile_name
            await bus.publish(EventName.MEMORY_CREATED, ctx.user_id, memory_id=mem.id)
            yield "memory", {"action": "created" if created else "updated", "memory": serialize(mem)}

    failed = any(not r.get("ok") and r.get("error_code") != "confirmation_required" for r in turn.tool_results)
    yield "state", {"state": "WARNING" if turn.pending else ("SUCCESS" if turn.tool_results and not failed else "IDLE")}
    yield "done", {"reply": reply, "provider": turn.provider, "tools": [
        {"tool": r["tool"], "ok": r.get("ok"), "error_code": r.get("error_code")} for r in turn.tool_results],
        "pending": turn.pending}
