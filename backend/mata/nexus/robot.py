"""Abstractions for future physical embodiment and smart-home devices.

No hardware is controlled today. `SimulatedRobot` records commands so the same
NEXUS brain can later drive a real robot by registering a new controller.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


class RobotController(ABC):
    name: str = "robot"

    @abstractmethod
    async def move(self, x: float, y: float, speed: float = 0.5) -> dict: ...
    @abstractmethod
    async def look(self, yaw: float, pitch: float) -> dict: ...
    @abstractmethod
    async def speak(self, text: str) -> dict: ...
    @abstractmethod
    async def listen(self, seconds: float = 5) -> dict: ...
    @abstractmethod
    async def gesture(self, name: str) -> dict: ...
    @abstractmethod
    async def navigate(self, target: str) -> dict: ...
    @abstractmethod
    async def camera(self) -> dict: ...
    @abstractmethod
    async def lights(self, color: str, intensity: float = 1.0) -> dict: ...
    @abstractmethod
    async def display(self, content: str) -> dict: ...


@dataclass
class SimulatedRobot(RobotController):
    """Drives nothing physical: logs commands (the on-screen avatar is the 'body')."""

    name: str = "simulated"
    log: list[dict] = field(default_factory=list)

    async def _rec(self, cmd: str, **kw: Any) -> dict:
        entry = {"cmd": cmd, **kw, "simulated": True}
        self.log.append(entry)
        return entry

    async def move(self, x, y, speed=0.5): return await self._rec("move", x=x, y=y, speed=speed)
    async def look(self, yaw, pitch): return await self._rec("look", yaw=yaw, pitch=pitch)
    async def speak(self, text): return await self._rec("speak", text=text)
    async def listen(self, seconds=5): return await self._rec("listen", seconds=seconds)
    async def gesture(self, name): return await self._rec("gesture", name=name)
    async def navigate(self, target): return await self._rec("navigate", target=target)
    async def camera(self): return await self._rec("camera")
    async def lights(self, color, intensity=1.0): return await self._rec("lights", color=color, intensity=intensity)
    async def display(self, content): return await self._rec("display", content=content)


class DeviceAdapter(ABC):
    """Smart-home device adapter (lights, TV, speakers, thermostat, plugs…). No hardware is hard-coded."""

    kind: str = "device"
    id: str = ""

    @abstractmethod
    async def state(self) -> dict: ...
    @abstractmethod
    async def command(self, action: str, **params: Any) -> dict: ...


class DeviceRegistry:
    def __init__(self) -> None:
        self._devices: dict[str, DeviceAdapter] = {}

    def register(self, device: DeviceAdapter) -> None:
        self._devices[device.id] = device

    def list(self) -> list[dict]:
        return [{"id": d.id, "kind": d.kind} for d in self._devices.values()]


devices = DeviceRegistry()
robot: RobotController = SimulatedRobot()
