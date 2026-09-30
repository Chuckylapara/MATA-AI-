# NEXUS — Architecture (implementation notes)

The authoritative design is **[../MASTER_ARCHITECTURE.md](../MASTER_ARCHITECTURE.md)**. This page maps it to code.

```
browser /nexus ── SSE ──► gateway ──► nexus service (FastAPI, :8014)
   avatar  (frontend/nexus/avatar)        orchestrator.py ─► router.py ─► providers/*
   voice   (frontend/nexus/voice)         memory.py (embeddings.py)
   vision  (frontend/nexus/vision)        tools/{base,builtin,web,registry}.py
   panels  (frontend/nexus/ui)            permissions.py · confirmation.py · security.py
   bus     (frontend/nexus/core/bus.ts)   events.py · audit.py · scheduler.py
                                          diagnostics.py · hardware.py · integrations.py · robot.py
```

## Turn lifecycle
1. `POST /nexus/converse {text}` → SSE.
2. Memories retrieved (top-K, scored) → system prompt (persona + profile + memories + tools).
3. Planner call (`structured_output`) returns `{reply}` or `{tool_calls}`; up to `NEXUS_MAX_STEPS` rounds.
4. Each tool call: integration check → schema validation → permission → risk gate → timeout → audit.
   HIGH risk → `PendingAction` + `confirmation_required` event; nothing runs until confirmed.
5. Final answer streams as `token` events; `state` events drive the avatar.
6. Rule-based fact extraction writes memories (name, projects, preferences…).

## Streaming protocol
`event:` ∈ `conversation, state, token, tool, agent, memory, confirmation_required, error, done`.
Clients ignore unknown events.

## Client event bus
`bus.emit/on` with `AVATAR_STATE_CHANGED, USER_INTERRUPTED, CAMERA_ENABLED/DISABLED, MIC_ENABLED/DISABLED,
TOOL_STARTED/COMPLETED, MEMORY_CREATED/RETRIEVED, CONFIRMATION_REQUIRED`. Camera and interruption events
are also posted to `/nexus/events` for the action feed and audit log.

## Data
All tables `nexus_*`, scoped by `user_id`; see [../DATABASE_ARCHITECTURE.md](../DATABASE_ARCHITECTURE.md).
