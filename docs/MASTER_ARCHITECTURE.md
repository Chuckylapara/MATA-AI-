# NEXUS AI — Master Architecture

> Status: **Phase 0 complete, Phases 1–8 foundations implemented** (see `ROADMAP.md` for the
> honest per-feature status). This document is the single source of truth for how NEXUS is
> put together. Every other `docs/*` NEXUS document drills into one part of it.

## 1. What NEXUS is

NEXUS is the orchestrating intelligence of MATA AI. It is **not a new app**; it is a new
layer that sits on top of the existing MATA AI platform (FastAPI microservices + Next.js)
and turns it into a personal AI operating environment:

```
                              USER
            voice · text · camera · touch · (future) robot sensors
                                │
┌───────────────────────────────▼────────────────────────────────────────┐
│  NEXUS CLIENT  (Next.js route /nexus — browser, TV, phone)              │
│   ├─ Avatar engine (Three.js + GLSL particles, state machine)          │
│   ├─ Voice loop (mic → VAD → STT → [server] → TTS → lip-sync)          │
│   ├─ Vision loop (camera → MediaPipe pose/hands/face → motion mirror)  │
│   ├─ Command center (Memory, Tasks, Permissions, Actions, System)      │
│   └─ Client event bus (AVATAR_STATE_CHANGED, USER_INTERRUPTED, …)      │
└───────────────────────────────┬────────────────────────────────────────┘
                     HTTPS + SSE (streaming) · Bearer JWT
┌───────────────────────────────▼────────────────────────────────────────┐
│  GATEWAY (existing) — JWT verify, rate limit, proxy → /nexus/*          │
└───────────────────────────────┬────────────────────────────────────────┘
┌───────────────────────────────▼────────────────────────────────────────┐
│  NEXUS SERVICE  (backend/mata/services/nexus, port 8014)               │
│                                                                        │
│   Orchestrator ──► Context engine ──► ModelRouter ──► ModelProvider(s) │
│        │                  │                                            │
│        │           Memory engine (embeddings, retrieval, consolidation)│
│        ▼                                                               │
│   Agent registry ── Research · Web · Memory · Planning · Vision · …    │
│        │                                                               │
│        ▼                                                               │
│   Tool registry ──► Permission manager ──► Confirmation engine         │
│        │                  │                        │                   │
│        ▼                  ▼                        ▼                   │
│   Tool execution     Audit log               Pending actions           │
│        │                                                               │
│   Event bus  ──► Action feed (SSE to client) · observability           │
│                                                                        │
│   Integrations registry (plugins) — each reports CONFIGURED / NOT      │
│   Hardware detection · Self-diagnostics · Task scheduler               │
│   RobotController / DeviceAdapter interfaces (future hardware)         │
└───────────────────────────────┬────────────────────────────────────────┘
                     PostgreSQL (prod) / SQLite (dev) · Redis (optional)
```

## 2. Guiding decisions

| Decision | Choice | Why |
|---|---|---|
| Where NEXUS lives | New `nexus` service + `mata/nexus` core package inside the existing repo | Reuses auth, gateway, DB, deploy pipeline. Nothing existing is rewritten. |
| Backend language | Python 3.11 / FastAPI (existing) | Already in production for MATA; best AI-library ecosystem. |
| Frontend | Next.js 14 / React 18 / Tailwind (existing) + Three.js | Existing app; Three.js is the most mature WebGL engine (MIT). |
| Streaming | **SSE** for server→client token/event streams; **WebSocket** reserved for bidirectional audio (Phase 4b) | SSE already passes through the gateway proxy unchanged; simplest reliable choice for text + events. |
| Speech (Phase 4a) | Browser Web Speech API (STT + TTS) behind a `VoiceProvider` interface | Zero cost, zero install, works today in Chrome/Edge/Safari. Upgrade path: Silero VAD + Whisper + Kokoro (see `TECHNOLOGY_RESEARCH.md`). |
| Vision | MediaPipe Tasks Vision in the browser (pose, hands, face) | Runs on-device (privacy), Apache-2.0, real-time on consumer hardware. Frames never leave the device unless the user asks a vision question. |
| Models | `ModelProvider` abstraction + `ModelRouter` (fast / reasoning / vision / embeddings roles) | No lock-in: Anthropic, OpenAI-compatible (OpenAI, NVIDIA NIM, Groq, Ollama local), Gemini. |
| Memory | Relational rows + embedding vectors (JSON in dev, pgvector-ready) + hybrid scoring | Works on SQLite with zero extensions; swap scorer to pgvector/sqlite-vec when scale requires. |
| Safety | Every tool declares risk + permission; the confirmation engine gates HIGH risk; everything is audited | Section 22–24, 54–56 of the spec. |
| Honesty | Unconfigured integrations return `integration_not_configured` with setup steps; the dev-only mock model labels every reply `[DEV MOCK]` | Spec section 43: no fake features. |

## 3. Request lifecycle (one conversational turn)

1. Client captures speech (or text). Final transcript → `POST /nexus/converse` (SSE).
2. Event `USER_SPOKE` published. Avatar → `THINKING`.
3. **Context engine** builds the prompt:
   - system persona (`mata/nexus/persona.py`) — calm, transparent, never claims consciousness;
   - user profile (name, language, preferences);
   - top-K memories from the **memory engine** (semantic + recency + importance);
   - short sliding window of the current conversation (not the whole history);
   - tool catalogue filtered by the user's permission state.
4. **Orchestrator** asks the model for either a reply or a tool plan (structured output).
5. For each tool call: permission check → risk classification → if HIGH risk, a
   `PendingAction` is created and the stream emits `confirmation_required`; the tool does
   **not** run until `POST /nexus/actions/{id}/confirm`.
6. Tool output from external sources is wrapped as **untrusted data** (prompt-injection
   defence, `mata/nexus/security.py`) before it re-enters the model.
7. Final answer streams as `token` events; avatar state events (`SEARCHING`, `SPEAKING`,
   `SUCCESS`, `ERROR`) stream alongside; every step lands in the **action feed** and
   **audit log**.
8. The memory engine extracts durable facts ("My name is Erick", "I'm building a company")
   and stores them (if memory is enabled for this user).

## 4. Module map (code)

```
backend/mata/nexus/
  events.py        Event bus (async pub/sub, typed event names, in-process; Redis-ready)
  models.py        SQLAlchemy entities (profile, memory, permission, task, audit, …)
  providers/       ModelProvider interface + Anthropic / OpenAI-compatible / Gemini / DevMock
  router.py        ModelRouter: picks provider per role (fast, reasoning, vision, embed)
  embeddings.py    Embedding providers + local hashing fallback (offline, deterministic)
  memory.py        Memory engine (write, retrieve, score, consolidate, expire, export)
  permissions.py   Central permission manager (ALLOW / DENY / ASK / TEMPORARY / TRUSTED)
  confirmation.py  Risk classification + pending-action lifecycle
  tools/           Tool interface, registry, built-in tools
  agents/          Agent interface, registry, built-in agents
  orchestrator.py  Intent → agent/tool plan → execution → streamed answer
  security.py      Untrusted-content wrapping, secret redaction, input limits
  audit.py         Audit log + action feed writer
  hardware.py      CPU/RAM/GPU/VRAM/OS/storage/network detection → local model advice
  diagnostics.py   Self-diagnostics (READY / WARNING / ERROR)
  integrations.py  Plugin/integration registry with configuration status
  robot.py         RobotController + DeviceAdapter abstractions (no hardware yet)
  scheduler.py     Task automation runner (schedule, retries, timeout, history)
backend/mata/services/nexus/app.py   HTTP API

frontend/app/nexus/                   NEXUS command center (route)
frontend/nexus/avatar/                Three.js particle avatar + state machine
frontend/nexus/voice/                 Voice loop (VAD, STT, TTS, barge-in)
frontend/nexus/vision/                Camera + MediaPipe + motion retargeting
frontend/nexus/core/                  Client event bus, API client, types
```

## 5. Multi-user isolation

- Every NEXUS table has `user_id` and every query filters by the authenticated identity
  (`mata.common.deps.get_identity`). There is no endpoint that takes a user id from the body.
- Memory retrieval is scoped per user before scoring; tests assert cross-user leakage is
  impossible (`backend/tests/nexus/test_memory.py::test_no_cross_user_leak`).
- Biometric identification is **not** implemented; identity = account authentication.

## 6. Extensibility contracts

| Extension | Contract | Register at |
|---|---|---|
| New model | subclass `ModelProvider` | `providers/__init__.py` |
| New tool | `Tool(name, description, input_schema, output_schema, permission, risk, timeout, handler)` | `tools/registry.py` or a plugin |
| New agent | subclass `Agent` with `name`, `capabilities`, `tools`, `run()` | `agents/registry.py` |
| New integration | `Integration(id, required_env, tools, agents)` | `integrations.py` |
| New device / robot | implement `DeviceAdapter` / `RobotController` | `robot.py` |
| New avatar state | add to `AvatarState` + a preset in `frontend/nexus/avatar/states.ts` | — |

## 7. Deployment topologies

- **Single PC (default)**: `devserver` (all services in one process) + SQLite + browser.
- **PC brain + TV display**: PC runs backend; TV/large monitor opens `/nexus?display=tv`
  (avatar-only, no chrome). Phone opens `/nexus?display=remote` as mic/camera/remote.
- **Cloud**: existing docker-compose/Render topology with Postgres + Redis; `nexus` is one
  more container (port 8014) behind the gateway.

See `ROADMAP.md` for what is built vs. planned.
