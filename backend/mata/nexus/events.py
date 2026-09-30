"""In-process async event bus.

Modules publish typed events; subscribers (action feed, SSE streams, metrics, the
scheduler) react independently. Subscribers can listen to one event name or "*".
A slow or failing subscriber never breaks the publisher.

The interface is deliberately tiny so a Redis-streams adapter can replace the
in-process implementation for multi-process deployments.
"""
from __future__ import annotations

import asyncio
import enum
import logging
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

log = logging.getLogger("nexus.events")


class EventName(str, enum.Enum):
    USER_SPOKE = "USER_SPOKE"
    USER_INTERRUPTED = "USER_INTERRUPTED"
    CAMERA_ENABLED = "CAMERA_ENABLED"
    CAMERA_DISABLED = "CAMERA_DISABLED"
    SEARCH_STARTED = "SEARCH_STARTED"
    SEARCH_COMPLETED = "SEARCH_COMPLETED"
    TOOL_STARTED = "TOOL_STARTED"
    TOOL_COMPLETED = "TOOL_COMPLETED"
    TOOL_FAILED = "TOOL_FAILED"
    MEMORY_CREATED = "MEMORY_CREATED"
    MEMORY_RETRIEVED = "MEMORY_RETRIEVED"
    TASK_STARTED = "TASK_STARTED"
    TASK_COMPLETED = "TASK_COMPLETED"
    TASK_FAILED = "TASK_FAILED"
    AVATAR_STATE_CHANGED = "AVATAR_STATE_CHANGED"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    PROVIDER_FALLBACK = "PROVIDER_FALLBACK"
    PERMISSION_CHANGED = "PERMISSION_CHANGED"


@dataclass
class Event:
    name: str
    user_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "user_id": self.user_id, "data": self.data, "ts": self.ts}


Handler = Callable[[Event], Awaitable[None] | None]


class EventBus:
    def __init__(self, history: int = 500) -> None:
        self._subs: dict[str, list[Handler]] = defaultdict(list)
        self._history: deque[Event] = deque(maxlen=history)

    def subscribe(self, name: str | EventName, handler: Handler) -> Callable[[], None]:
        key = name.value if isinstance(name, EventName) else name
        self._subs[key].append(handler)

        def unsubscribe() -> None:
            if handler in self._subs[key]:
                self._subs[key].remove(handler)

        return unsubscribe

    async def publish(self, name: str | EventName, user_id: str | None = None, **data: Any) -> Event:
        key = name.value if isinstance(name, EventName) else name
        event = Event(name=key, user_id=user_id, data=data)
        self._history.append(event)
        for handler in [*self._subs.get(key, []), *self._subs.get("*", [])]:
            try:
                res = handler(event)
                if asyncio.iscoroutine(res):
                    await res
            except Exception:  # noqa: BLE001 — subscribers must never break publishers
                log.exception("event subscriber failed for %s", key)
        return event

    def recent(self, user_id: str | None = None, limit: int = 50) -> list[Event]:
        items = [e for e in self._history if user_id is None or e.user_id == user_id]
        return items[-limit:]


bus = EventBus()
