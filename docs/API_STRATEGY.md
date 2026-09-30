# NEXUS — API Strategy

## 1. Public NEXUS API (through the gateway at `/nexus/*`)

All endpoints require `Authorization: Bearer <access token>` and are scoped to the caller.

| Method & path | Purpose |
|---|---|
| `GET  /nexus/status` | model routing, integrations, agents, feature flags |
| `POST /nexus/converse` | **SSE** conversational turn. Events: `state`, `token`, `tool`, `confirmation_required`, `memory`, `done`, `error` |
| `POST /nexus/vision/ask` | one camera frame (base64) + question → answer (vision permission + provider required) |
| `GET/PUT /nexus/profile` · `DELETE /nexus/profile` | identity/preferences; delete all personal data |
| `GET /nexus/memories?q=&type=` · `POST` · `PATCH /{id}` · `DELETE /{id}` · `DELETE /nexus/memories` · `GET /nexus/memories/export` · `PUT /nexus/memory-settings` | Memory Center |
| `GET /nexus/permissions` · `PUT /nexus/permissions/{capability}` | permission manager |
| `GET/POST/DELETE /nexus/trusted-rules` | trusted automation rules |
| `GET /nexus/actions/pending` · `POST /{id}/confirm` · `POST /{id}/reject` | confirmation engine |
| `GET /nexus/feed` | action feed |
| `GET /nexus/audit` | audit log |
| `GET/POST /nexus/tasks` · `PATCH/DELETE /{id}` · `POST /{id}/pause|resume|run` · `GET /{id}/runs` | Automation Center |
| `GET /nexus/tools` · `GET /nexus/agents` · `GET /nexus/integrations` | registries |
| `GET /nexus/system/hardware` · `GET /nexus/system/health` | hardware detection & self-diagnostics |

## 2. Third-party API policy

1. **Official, documented APIs first.** Browser automation is a fallback only where the site
   permits it and no API exists.
2. **Never bypass** DRM, paywalls, logins, CAPTCHAs, rate limits or platform restrictions.
3. **Every integration is a plugin** with `required_env`, `docs_url`, `tools`, `status`.
   Missing credentials → status `NOT CONFIGURED` and tools return:
   ```json
   {"ok": false, "error_code": "integration_not_configured",
    "error": "Integration 'gmail' not configured.",
    "setup": ["Create an OAuth client…", "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"]}
   ```
4. Keys live only on the server (env / secret manager). The browser never receives them.
5. Paid APIs are marked 💲 in `TECHNOLOGY_RESEARCH.md` and are never the only option.

## 3. Provider abstraction pattern

Search: `SearchProvider.search(query, n) -> [SearchHit]` with `SearxngSearch`, `TavilySearch`,
`BraveSearch`, `WikipediaSearch`. Order via `NEXUS_SEARCH_PROVIDERS` (default
`searxng,tavily,brave,wikipedia`, unconfigured ones skipped). Same pattern for models
(`ModelProvider`), voice (`VoiceProvider`, client), vision (`VisionProvider`), robots
(`RobotController`) and devices (`DeviceAdapter`).

## 4. Streaming format

`text/event-stream`, one JSON object per `data:` line, `event:` name set. Clients must
tolerate unknown event names (forward compatibility). The existing gateway proxy streams SSE
unchanged.
