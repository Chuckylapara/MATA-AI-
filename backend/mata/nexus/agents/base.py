"""Agent interface. Agents are modular specialists the orchestrator can delegate to."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from mata.nexus.tools.base import ToolContext


@dataclass
class AgentResult:
    ok: bool
    summary: str
    data: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class Agent(ABC):
    name: str = "agent"
    description: str = ""
    capabilities: list[str] = []
    tools: list[str] = []
    #: ready | not_configured | planned
    status: str = "ready"
    phase: int | None = None

    def describe(self) -> dict:
        return {"name": self.name, "description": self.description, "capabilities": self.capabilities,
                "tools": self.tools, "status": self.status, "phase": self.phase}

    @abstractmethod
    async def run(self, ctx: ToolContext, goal: str, **kwargs: Any) -> AgentResult: ...


class PlannedAgent(Agent):
    """Placeholder for agents scheduled in later phases. Never offered to the model."""

    status = "planned"

    def __init__(self, name: str, description: str, phase: int, capabilities: list[str]) -> None:
        self.name, self.description, self.phase, self.capabilities = name, description, phase, capabilities

    async def run(self, ctx: ToolContext, goal: str, **kwargs: Any) -> AgentResult:
        return AgentResult(False, f"The {self.name} agent is planned for phase {self.phase}.", error="planned")
