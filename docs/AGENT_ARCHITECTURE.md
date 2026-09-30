# NEXUS — Agent & Tool Architecture

## 1. Layers

```
Orchestrator  (decides: answer directly | call tools | delegate to an agent | ask a question)
   │
   ├── Agent registry     Research · Web · Browser · Vision · Memory · Coding · Shopping ·
   │                       Communication · Social · Content · Website · Creative ·
   │                       Planning · Security
   │
   └── Tool registry      web_search · web_fetch · memory_search · memory_write · …
            │
            ▼
      Permission manager → Confirmation engine → execute (timeout) → audit + events
```

## 2. Tool contract (`mata/nexus/tools/base.py`)

| Field | Meaning |
|---|---|
| `name` | unique id (`web_search`) |
| `description` | shown to the model |
| `input_schema` / `output_schema` | JSON Schema; input validated before execution |
| `permission` | capability required (`BROWSER`, `EMAIL`, `SHOPPING`, …) or `None` |
| `risk` | `LOW` / `MEDIUM` / `HIGH` |
| `confirmation_required` | derived from risk (HIGH) unless overridden |
| `timeout_s` | hard timeout |
| `integration` | plugin id that must be configured, if any |
| `untrusted_output` | output comes from the outside world → wrapped for injection defence |
| `handler(ctx, **args)` | async; returns `ToolResult(ok, data, error, error_code)` |

Execution pipeline (`ToolExecutor.run`): lookup → integration configured? → permission
(ALLOW/ASK/DENY/TEMPORARY/TRUSTED) → schema validation → risk gate (pending action if needed)
→ `TOOL_STARTED` event → run with timeout → `TOOL_COMPLETED` / `TOOL_FAILED` → audit row.
Errors never crash the turn; they become structured results the model and UI can explain.

## 3. Agent contract (`mata/nexus/agents/base.py`)

```python
class Agent(ABC):
    name: str; description: str; capabilities: list[str]; tools: list[str]
    status: "ready" | "not_configured" | "planned"
    async def run(self, ctx, goal: str) -> AgentResult   # emits events as it works
```

Agents marked `planned` appear in the UI with that label and are never offered to the
model — no fake capability.

## 4. Built-in status (this milestone)

| Agent | Status | Notes |
|---|---|---|
| Memory | ready | search / write / forget via memory engine |
| Research | ready | multi-query search → fetch → extract → compare → cited report |
| Web | ready | search provider chain (SearXNG, Tavily, Brave, Wikipedia) + page fetch |
| Planning | ready | tasks/reminders via scheduler |
| Vision | ready (client-side tracking) / server VLM when a vision provider is configured |
| Security | ready | injection scanning, permission review |
| Browser | planned (Phase 10, Playwright) |
| Communication | not_configured until Gmail/Telegram integration; drafts supported |
| Social | not_configured (Phase 13) |
| Shopping | planned (Phase 14) — search/compare first; purchase always confirmed |
| Content / Creative | partially via existing MATA Studio endpoints (Phase 15) |
| Website / Coding | planned (Phase 16/17), sandboxed |

## 5. Orchestration strategy

1. Build context (persona, profile, memories, recent turns, allowed tools).
2. Ask the `reasoning` model with native tool use where supported (Anthropic, OpenAI-compatible);
   otherwise use `structured_output` with a `{ "reply" | "tool_calls" }` schema.
3. Loop at most `NEXUS_MAX_STEPS` (default 6) tool rounds.
4. Stream the final answer. On HIGH risk, stop and stream `confirmation_required`.
5. Post-turn: memory extraction (fast model or rule-based fallback).

## 6. Event bus (`mata/nexus/events.py`)

Typed events: `USER_SPOKE, USER_INTERRUPTED, CAMERA_ENABLED, CAMERA_DISABLED,
SEARCH_STARTED, SEARCH_COMPLETED, TOOL_STARTED, TOOL_COMPLETED, TOOL_FAILED,
MEMORY_CREATED, MEMORY_RETRIEVED, TASK_STARTED, TASK_COMPLETED, TASK_FAILED,
AVATAR_STATE_CHANGED, CONFIRMATION_REQUIRED, PROVIDER_FALLBACK, PERMISSION_CHANGED`.
In-process async pub/sub now; a Redis stream adapter can be dropped in for multi-process.
The client has a mirror bus (`frontend/nexus/core/bus.ts`) fed by SSE.

## 7. Future physical robot

`mata/nexus/robot.py` defines `RobotController` (`move, look, speak, listen, gesture,
navigate, camera, lights, display`) and `DeviceAdapter` for smart-home devices. A
`SimulatedRobot` implementation drives the on-screen avatar, so the same brain can later
drive hardware by registering a new controller.
