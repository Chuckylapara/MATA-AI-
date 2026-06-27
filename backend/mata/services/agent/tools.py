"""Tool registry for the agent. Each tool is a JSON-schema'd callable.

Add a new tool = add an entry here. The agent loop and the Anthropic tool-use
schema are both generated from TOOLS, so there is one source of truth.
"""
from __future__ import annotations

import ast
import datetime as _dt
import operator
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

# --- Safe arithmetic evaluator (no eval) ---
_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.Pow: operator.pow, ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def _safe_eval(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp):
        return _OPS[type(node.op)](_safe_eval(node.left), _safe_eval(node.right))
    if isinstance(node, ast.UnaryOp):
        return _OPS[type(node.op)](_safe_eval(node.operand))
    raise ValueError("Unsupported expression")


async def calculator(expression: str) -> str:
    return str(_safe_eval(ast.parse(expression, mode="eval").body))


async def current_time(timezone: str = "UTC") -> str:
    return _dt.datetime.now(_dt.timezone.utc).isoformat()


async def http_get(url: str) -> str:
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        resp = await client.get(url)
        return resp.text[:2000]


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[..., Awaitable[str]]


TOOLS: dict[str, Tool] = {
    "calculator": Tool(
        "calculator", "Evaluate an arithmetic expression, e.g. '2*(3+4)'.",
        {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]},
        calculator,
    ),
    "current_time": Tool(
        "current_time", "Get the current UTC time as ISO-8601.",
        {"type": "object", "properties": {"timezone": {"type": "string"}}},
        current_time,
    ),
    "http_get": Tool(
        "http_get", "Fetch the text body of a public URL (first 2000 chars).",
        {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]},
        http_get,
    ),
}


def anthropic_tool_specs() -> list[dict]:
    return [{"name": t.name, "description": t.description, "input_schema": t.parameters} for t in TOOLS.values()]
