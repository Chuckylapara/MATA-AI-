# NEXUS — Feature Matrix

Honest status of every capability in the spec. **Status** values:

- **Working** — implemented and covered by tests or verified in a browser.
- **Needs config** — implemented; needs a key/credential or local service (shows *Integration not configured* until then).
- **Foundation** — interfaces/data model exist; user-facing flow incomplete.
- **Planned** — not built yet; shown in UI as "planned" (never as working).

| # | Capability | Status | Implementation | Dependencies / cost |
|---|---|---|---|---|
| 2 | Natural conversation (ES/EN, no rigid commands) | Planned | orchestrator + persona | any LLM provider |
| 3 | Real-time voice, streaming STT/TTS, barge-in | Planned | Web Speech API; Silero/Whisper/Kokoro later | free |
| 4–6 | Particle avatar, 16 states, animation | Planned | Three.js + GLSL | free |
| 7 | Camera vision Q&A / OCR | Planned | VLM provider | free tiers |
| 8 | Body/hand/face motion mirroring | Planned | MediaPipe Tasks Vision | free, on-device |
| 9 | Multi-user identity & profile | Planned | existing JWT auth + `nexus_profiles` | — |
| 10–11 | Long-term memory + Memory Center | Planned | memory engine | free (local embeddings) |
| 12 | Web research with citations | Planned | search chain + fetch | Wikipedia free; SearXNG free self-host; Tavily free tier |
| 13 | Movie/video lookup (legal sources only) | Planned | web agent | — |
| 14 | Browser automation | Planned | Playwright | free |
| 15 | Shopping (confirmation mandatory) | Planned | plugin | store APIs |
| 16 | Email / messaging / calendar | Planned | plugins (OAuth) | free w/ OAuth |
| 17 | Social media center | Planned | plugins | official APIs |
| 18, 49 | Content creation / Creator mode | Planned | MATA Studio reuse | mixed |
| 19–20 | Website builder / coding agent | Planned | sandbox | — |
| 21 | Multi-agent registry | Planned | agent registry | — |
| 22 | Tool registry (standard interface) | Planned | tool registry | — |
| 23 | Permission manager | Planned | permissions | — |
| 24, 55 | Confirmation engine, draft vs action | Planned | confirmation | — |
| 25–26 | Task automation / Automation Center | Planned | scheduler | — |
| 27 | File intelligence | Planned | document pipeline | — |
| 31 | Local + cloud model abstraction | Planned | providers + router | — |
| 32 | Hardware detection | Planned | psutil + nvidia-smi | — |
| 33, 46, 47 | Command-center UI, TV mode, mobile | Planned | Next.js | — |
| 35, 57 | Developer dashboard, self-diagnostics | Planned | diagnostics | — |
| 36–37 | Error recovery, observability | Planned | executor + audit | — |
| 38 | Plugin system | Planned | integrations registry | — |
| 39 | Event bus | Planned | events | — |
| 45 | Robot abstraction | Planned | robot.py | — |
| 48 | Smart-home adapters | Planned | DeviceAdapter | — |
| 54 | Prompt-injection defence | Planned | security.py | — |
| 56 | Action feed | Planned | audit/feed | — |

This table is updated at the end of every phase.
