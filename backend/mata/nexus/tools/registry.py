"""Tool registry. Plugins add tools with `registry.register(tool)`."""
from __future__ import annotations

from mata.nexus.tools.base import Tool, ToolExecutor
from mata.nexus.tools.builtin import builtin_tools


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"Tool '{tool.name}' already registered")
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def all(self) -> list[Tool]:
        return list(self._tools.values())

    def available(self) -> list[Tool]:
        """Tools whose integration (if any) is configured — the only ones offered to the model."""
        from mata.nexus.integrations import integration_status

        return [t for t in self._tools.values() if not t.integration or integration_status(t.integration)["configured"]]


registry = ToolRegistry()
for _t in builtin_tools():
    registry.register(_t)

executor = ToolExecutor(registry)


# --- Agent-backed tools -------------------------------------------------------
def _register_agent_tools() -> None:
    from mata.nexus.agents.research import ResearchAgent
    from mata.nexus.models import Risk
    from mata.nexus.permissions import Capability
    from mata.nexus.tools.base import ToolContext, ToolResult

    agent = ResearchAgent()

    async def research_topic(ctx: ToolContext, topic: str, depth: int = 3, lang: str = "en") -> ToolResult:
        res = await agent.run(ctx, topic, depth=depth, lang=lang)
        return ToolResult(res.ok, {"report": res.summary, **res.data}, res.error, None if res.ok else "failed")

    registry.register(Tool(
        "research_topic", "Deep research: several searches, opens sources, compares them and writes a cited brief.",
        {"type": "object", "properties": {"topic": {"type": "string", "maxLength": 300},
                                          "depth": {"type": "integer", "minimum": 1, "maximum": 6},
                                          "lang": {"type": "string"}}, "required": ["topic"]},
        research_topic, permission=Capability.WEB, risk=Risk.low, untrusted_output=True, category="web",
        timeout_s=150))


_register_agent_tools()
