"""Agent registry. New agents register here (or from a plugin) without touching the orchestrator."""
from __future__ import annotations

from typing import Any

from mata.nexus.agents.base import Agent, AgentResult, PlannedAgent
from mata.nexus.agents.research import ResearchAgent
from mata.nexus.tools.base import ToolContext


class _ToolBackedAgent(Agent):
    """Agents whose work is done by a set of tools the orchestrator calls directly."""

    def __init__(self, name: str, description: str, tools: list[str], capabilities: list[str], phase: int) -> None:
        self.name, self.description, self.tools, self.capabilities, self.phase = (
            name, description, tools, capabilities, phase)

    async def run(self, ctx: ToolContext, goal: str, **kwargs: Any) -> AgentResult:
        return AgentResult(False, f"{self.name} works through its tools: {', '.join(self.tools)}")


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[str, Agent] = {}

    def register(self, agent: Agent) -> None:
        self._agents[agent.name] = agent

    def get(self, name: str) -> Agent | None:
        return self._agents.get(name)

    def all(self) -> list[Agent]:
        return list(self._agents.values())


agents = AgentRegistry()
agents.register(ResearchAgent())
agents.register(_ToolBackedAgent("web", "Search and read public web pages.", ["web_search", "web_fetch", "weather"],
                                 ["search", "read"], 9))
agents.register(_ToolBackedAgent("memory", "Remember, recall and forget user facts.",
                                 ["memory_search", "memory_write", "memory_forget"], ["remember", "recall"], 6))
agents.register(_ToolBackedAgent("planning", "Reminders and scheduled tasks.", ["task_create"],
                                 ["schedule", "remind"], 18))
agents.register(_ToolBackedAgent("communication", "Draft messages; sending needs a configured integration.",
                                 ["email_draft", "email_send"], ["draft", "send"], 12))
agents.register(_ToolBackedAgent("security", "Injection scanning, permission & audit review.", [],
                                 ["scan", "audit"], 19))
_vision = _ToolBackedAgent("vision", "Camera understanding (client-side tracking + server VLM on request).", [],
                           ["describe", "ocr", "pose", "hands", "face"], 7)
agents.register(_vision)
for name, desc, phase, caps in [
    ("browser", "Automate permitted websites with Playwright.", 10, ["navigate", "click", "type", "read"]),
    ("shopping", "Search and compare products; purchases always confirmed.", 14, ["search", "compare", "cart"]),
    ("social", "Manage connected social accounts through official APIs.", 13, ["post", "schedule", "analytics"]),
    ("content", "Scripts, captions, thumbnails and production plans.", 15, ["script", "plan", "caption"]),
    ("creative", "Image, video and music generation workflows.", 15, ["image", "video", "music"]),
    ("website", "Plan, build and test websites in a sandbox.", 16, ["plan", "build", "test"]),
    ("coding", "Read, write and test code in a sandbox.", 17, ["read", "edit", "test", "debug"]),
]:
    agents.register(PlannedAgent(name, desc, phase, caps))
