"""Built-in NEXUS tools. Each is a real implementation or an honest NOT-CONFIGURED stub."""
from __future__ import annotations

import ast
import operator
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from mata.nexus.events import EventName, bus
from mata.nexus.memory import MemoryRejected, serialize
from mata.nexus.models import MemoryType, NexusTask, Risk
from mata.nexus.permissions import Capability
from mata.nexus.security import wrap_untrusted
from mata.nexus.tools import web
from mata.nexus.tools.base import Tool, ToolContext, ToolResult

# --------------------------------------------------------------------------- utility

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.USub: operator.neg, ast.UAdd: operator.pos,
        ast.FloorDiv: operator.floordiv}


def _safe_eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _safe_eval(node.left), _safe_eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return _OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError("unsupported expression")


async def calculator(ctx: ToolContext, expression: str) -> ToolResult:
    try:
        value = _safe_eval(ast.parse(expression.replace("^", "**"), mode="eval").body)
    except (SyntaxError, ValueError, ZeroDivisionError) as exc:
        return ToolResult(False, error=f"Cannot evaluate: {exc}", error_code="invalid_input")
    return ToolResult(True, {"expression": expression, "result": value})


async def current_time(ctx: ToolContext, timezone_name: str = "UTC") -> ToolResult:
    try:
        tz = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError:
        return ToolResult(False, error=f"Unknown timezone {timezone_name}", error_code="invalid_input")
    now = datetime.now(tz)
    return ToolResult(True, {"iso": now.isoformat(), "timezone": timezone_name, "weekday": now.strftime("%A")})


async def weather(ctx: ToolContext, place: str) -> ToolResult:
    """Open-Meteo (free, keyless, official API)."""
    async with httpx.AsyncClient(timeout=15) as c:
        g = await c.get("https://geocoding-api.open-meteo.com/v1/search", params={"name": place, "count": 1})
        results = g.json().get("results") if g.status_code == 200 else None
        if not results:
            return ToolResult(False, error=f"Place not found: {place}", error_code="not_found")
        loc = results[0]
        w = await c.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": loc["latitude"], "longitude": loc["longitude"], "timezone": "auto",
            "current": "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max", "forecast_days": 3})
    if w.status_code != 200:
        return ToolResult(False, error=f"Weather service HTTP {w.status_code}", error_code="failed")
    data = w.json()
    return ToolResult(True, {"place": f"{loc['name']}, {loc.get('country', '')}", "current": data.get("current"),
                             "daily": data.get("daily"), "source": "open-meteo.com"})


# --------------------------------------------------------------------------- web

async def web_search(ctx: ToolContext, query: str, max_results: int = 6, lang: str = "en") -> ToolResult:
    await bus.publish(EventName.SEARCH_STARTED, ctx.user_id, query=query)
    await ctx.event("state", {"state": "SEARCHING"})
    try:
        hits, errors = await web.search(query, max_results, lang)
    except web.SearchError as exc:
        return ToolResult(False, error=str(exc), error_code="failed")
    await bus.publish(EventName.SEARCH_COMPLETED, ctx.user_id, query=query, count=len(hits))
    fenced = [{"title": h.title, "url": h.url, "provider": h.source,
               "snippet": wrap_untrusted(h.snippet, h.url)} for h in hits]
    return ToolResult(True, {"query": query, "results": fenced, "provider_errors": errors})


async def web_fetch(ctx: ToolContext, url: str) -> ToolResult:
    await ctx.event("state", {"state": "READING"})
    try:
        page = await web.fetch_page(url)
    except web.UnsafeURL as exc:
        return ToolResult(False, error=str(exc), error_code="invalid_input")
    except httpx.HTTPError as exc:
        return ToolResult(False, error=f"Fetch failed: {exc}", error_code="failed")
    if not page.get("ok"):
        return ToolResult(False, data={"url": page["url"]}, error=page.get("error"), error_code="failed")
    return ToolResult(True, {"url": page["url"], "title": page["title"], "truncated": page["truncated"],
                             "content": wrap_untrusted(page["text"], page["url"])})


# --------------------------------------------------------------------------- memory

async def memory_search(ctx: ToolContext, query: str, limit: int = 6) -> ToolResult:
    if not ctx.memory_enabled:
        return ToolResult(False, error="Memory is disabled by the user.", error_code="disabled")
    found = await ctx.memory.search(query, k=limit)
    await bus.publish(EventName.MEMORY_RETRIEVED, ctx.user_id, count=len(found))
    return ToolResult(True, {"memories": [{"id": r.memory.id, "type": r.memory.type.value,
                                           "content": r.memory.content, "score": r.score} for r in found]})


async def memory_write(ctx: ToolContext, content: str, type: str = "semantic", importance: float = 0.7) -> ToolResult:
    if not ctx.memory_enabled:
        return ToolResult(False, error="Memory is disabled by the user.", error_code="disabled")
    try:
        mem, created = await ctx.memory.write(content, type=type, importance=importance,
                                              source="tool" if ctx.tainted else "user")
    except (MemoryRejected, ValueError) as exc:
        return ToolResult(False, error=str(exc), error_code="rejected")
    await bus.publish(EventName.MEMORY_CREATED, ctx.user_id, memory_id=mem.id)
    await ctx.event("memory", {"action": "created" if created else "updated", "memory": serialize(mem)})
    return ToolResult(True, {"memory_id": mem.id, "created": created})


async def memory_forget(ctx: ToolContext, memory_id: str) -> ToolResult:
    ok = await ctx.memory.delete(memory_id)
    return ToolResult(ok, {"deleted": ok} if ok else None, None if ok else "Memory not found",
                      None if ok else "not_found")


# --------------------------------------------------------------------------- tasks

async def task_create(ctx: ToolContext, title: str, kind: str = "reminder", in_minutes: int | None = None,
                      at: str | None = None, every_minutes: int | None = None, query: str | None = None,
                      url: str | None = None) -> ToolResult:
    now = datetime.now(timezone.utc)
    if every_minutes:
        schedule = {"type": "interval", "every_minutes": max(15, every_minutes)}
        next_run = now + timedelta(minutes=schedule["every_minutes"])
    else:
        if at:
            try:
                next_run = datetime.fromisoformat(at.replace("Z", "+00:00"))
            except ValueError:
                return ToolResult(False, error="'at' must be ISO-8601", error_code="invalid_input")
            if next_run.tzinfo is None:
                next_run = next_run.replace(tzinfo=timezone.utc)
        else:
            next_run = now + timedelta(minutes=in_minutes or 60)
        schedule = {"type": "once", "at": next_run.isoformat()}
    params = {k: v for k, v in {"query": query, "url": url}.items() if v}
    task = NexusTask(user_id=ctx.user_id, title=title[:200], kind=kind, params=params, schedule=schedule,
                     next_run_at=next_run)
    ctx.db.add(task)
    await ctx.db.flush()
    return ToolResult(True, {"task_id": task.id, "title": task.title, "kind": kind, "next_run_at": next_run.isoformat(),
                             "schedule": schedule})


# --------------------------------------------------------------------------- communication (draft vs action)

def _email_preview(args: dict) -> dict:
    return {"type": "email", "to": args.get("to"), "subject": args.get("subject"), "body": args.get("body")}


async def email_draft(ctx: ToolContext, to: str, subject: str, body: str) -> ToolResult:
    """Drafts are local and safe — nothing leaves NEXUS."""
    return ToolResult(True, {"draft": _email_preview({"to": to, "subject": subject, "body": body}),
                             "status": "draft", "note": "Draft only. Say 'send it' to send (requires confirmation)."})


async def email_send(ctx: ToolContext, to: str, subject: str, body: str) -> ToolResult:  # pragma: no cover
    # Reached only once the Gmail integration is implemented AND configured.
    return ToolResult(False, error="Email sending is not implemented yet.", error_code="integration_not_configured")


def _purchase_preview(args: dict) -> dict:
    return {"type": "purchase", "product": args.get("product"), "price": args.get("price"),
            "seller": args.get("seller"), "note": "Shipping, tax, total and return policy shown before purchase."}


async def _not_implemented(ctx: ToolContext, **_: object) -> ToolResult:  # pragma: no cover
    return ToolResult(False, error="Not implemented yet.", error_code="integration_not_configured")


# --------------------------------------------------------------------------- registry entries

def builtin_tools() -> list[Tool]:
    obj = "object"
    return [
        Tool("calculator", "Evaluate an arithmetic expression like '2*(3+4)/5'.",
             {"type": obj, "properties": {"expression": {"type": "string", "maxLength": 200}},
              "required": ["expression"]}, calculator, category="utility"),
        Tool("current_time", "Get the current date and time in a timezone (IANA name, e.g. 'Europe/Madrid').",
             {"type": obj, "properties": {"timezone_name": {"type": "string"}}}, current_time, category="utility"),
        Tool("weather", "Current weather and 3-day forecast for a place (Open-Meteo).",
             {"type": obj, "properties": {"place": {"type": "string", "maxLength": 120}}, "required": ["place"]},
             weather, permission=Capability.WEB, category="web", timeout_s=20),
        Tool("web_search", "Search the web. Returns titles, URLs and snippets (external, untrusted).",
             {"type": obj, "properties": {"query": {"type": "string", "maxLength": 300},
                                         "max_results": {"type": "integer", "minimum": 1, "maximum": 10},
                                         "lang": {"type": "string"}}, "required": ["query"]},
             web_search, permission=Capability.WEB, untrusted_output=True, category="web", timeout_s=30),
        Tool("web_fetch", "Open a public web page and extract its readable text (external, untrusted).",
             {"type": obj, "properties": {"url": {"type": "string", "maxLength": 2000}}, "required": ["url"]},
             web_fetch, permission=Capability.WEB, untrusted_output=True, category="web", timeout_s=30),
        Tool("memory_search", "Search the user's long-term memory.",
             {"type": obj, "properties": {"query": {"type": "string"},
                                         "limit": {"type": "integer", "minimum": 1, "maximum": 20}},
              "required": ["query"]}, memory_search, permission=Capability.MEMORY, category="memory"),
        Tool("memory_write", "Store a durable fact about the user or their projects.",
             {"type": obj, "properties": {"content": {"type": "string", "maxLength": 2000},
                                         "type": {"type": "string", "enum": [t.value for t in MemoryType]},
                                         "importance": {"type": "number", "minimum": 0, "maximum": 1}},
              "required": ["content"]}, memory_write, permission=Capability.MEMORY, risk=Risk.medium,
             category="memory"),
        Tool("memory_forget", "Delete one memory by id.",
             {"type": obj, "properties": {"memory_id": {"type": "string"}}, "required": ["memory_id"]},
             memory_forget, permission=Capability.MEMORY, risk=Risk.high, category="memory",
             preview=lambda a: {"type": "delete_memory", "memory_id": a.get("memory_id")}),
        Tool("task_create", "Create a reminder or scheduled task (kinds: reminder, web_search, monitor_url).",
             {"type": obj, "properties": {
                 "title": {"type": "string", "maxLength": 200},
                 "kind": {"type": "string", "enum": ["reminder", "web_search", "monitor_url"]},
                 "in_minutes": {"type": "integer", "minimum": 1, "maximum": 525600},
                 "at": {"type": "string"}, "every_minutes": {"type": "integer", "minimum": 15},
                 "query": {"type": "string"}, "url": {"type": "string"}}, "required": ["title"]},
             task_create, permission=Capability.TASKS, risk=Risk.medium, category="tasks"),
        Tool("email_draft", "Prepare an email draft for the user to review (does not send).",
             {"type": obj, "properties": {"to": {"type": "string"}, "subject": {"type": "string"},
                                         "body": {"type": "string", "maxLength": 5000}},
              "required": ["to", "subject", "body"]}, email_draft, risk=Risk.medium, category="communication"),
        Tool("email_send", "Send an email (HIGH risk, always confirmed).",
             {"type": obj, "properties": {"to": {"type": "string"}, "subject": {"type": "string"},
                                         "body": {"type": "string"}}, "required": ["to", "subject", "body"]},
             email_send, permission=Capability.EMAIL, risk=Risk.high, integration="gmail",
             preview=_email_preview, category="communication"),
        Tool("shopping_purchase", "Purchase a product (HIGH risk, always confirmed; never trusted-automated).",
             {"type": obj, "properties": {"product": {"type": "string"}, "price": {"type": "string"},
                                         "seller": {"type": "string"}}, "required": ["product"]},
             _not_implemented, permission=Capability.SHOPPING, risk=Risk.high, integration="shopping",
             preview=_purchase_preview, category="shopping"),
        Tool("social_publish", "Publish a post to a connected social account (HIGH risk).",
             {"type": obj, "properties": {"platform": {"type": "string"}, "text": {"type": "string"}},
              "required": ["platform", "text"]}, _not_implemented, permission=Capability.SOCIAL, risk=Risk.high,
             integration="youtube", category="social"),
    ]
