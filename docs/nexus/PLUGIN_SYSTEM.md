# NEXUS — Plugins & integrations

The core never hard-codes a service. Three registries:

1. **Integrations** (`backend/mata/nexus/integrations.py`): `Integration(id, name, category,
   required, setup, docs_url, provides, cost, implementation)`. Status is computed from real
   configuration: CONFIGURED / NOT CONFIGURED / PLANNED.
2. **Tools** (`tools/registry.py`): `registry.register(Tool(...))` with name, description,
   input/output schema, permission, risk, timeout, integration, untrusted_output, preview.
   Tools whose integration isn't configured are hidden from the model and return
   `integration_not_configured` with setup steps if called.
3. **Agents** (`agents/registry.py`): subclass `Agent`, `agents.register(...)`.

Minimal plugin:
```python
# backend/mata/nexus/plugins/telegram.py
from mata.nexus.tools.registry import registry
from mata.nexus.tools.base import Tool, ToolResult
from mata.nexus.models import Risk
from mata.nexus.permissions import Capability

async def telegram_send(ctx, chat_id: str, text: str) -> ToolResult:
    ...  # call the official Bot API with settings/env token
    return ToolResult(True, {"sent": True})

registry.register(Tool("telegram_send", "Send a Telegram message.",
    {"type": "object", "properties": {"chat_id": {"type": "string"}, "text": {"type": "string"}},
     "required": ["chat_id", "text"]},
    telegram_send, permission=Capability.MESSAGING, risk=Risk.high, integration="telegram",
    preview=lambda a: {"type": "message", "to": a["chat_id"], "text": a["text"]}))
```
Import the module at startup and set the integration's `implementation="available"`.

Future: UI contributions, OAuth flows and event subscriptions per plugin; device adapters
(`robot.py: DeviceAdapter`) and robot controllers (`RobotController`) follow the same pattern.
