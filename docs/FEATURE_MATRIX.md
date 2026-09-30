# NEXUS — Feature Matrix

Honest status of every capability in the spec. **Status** values:

- **Working** — implemented and covered by automated tests or verified in a browser.
- **Needs config** — implemented; needs a key/credential or local service (shows *Integration not configured* until then).
- **Foundation** — interfaces/data model exist; user-facing flow incomplete.
- **Planned** — not built yet; shown in the UI as "planned" (never as working).

| # | Capability | Status | Implementation | Dependencies / cost |
|---|---|---|---|---|
| 2 | Natural conversation (ES/EN, no rigid commands) | Needs config | orchestrator + persona + planner | any LLM provider (Ollama free); dev mock otherwise |
| 3 | Real-time voice, streaming STT/TTS, barge-in | Working | `VoiceEngine` (Web Speech API) | free; Chromium/Safari |
| 3 | Local private voice (Whisper/Kokoro/Silero) | Planned | Phase 4b | free, local |
| 4–6 | Particle avatar per reference, 16 states, animation, lip-sync | Working | Three.js + GLSL | free |
| 7 | Camera vision Q&A / OCR | Needs config | `/vision/ask` + VLM router | vision-capable provider |
| 8 | Body/hand/face motion mirroring | Working (manual camera check) | MediaPipe Tasks Vision + One-Euro | free, on-device |
| 9 | Multi-user identity & profile | Working | JWT auth + `nexus_profiles`; name learnt from speech | — |
| 10–11 | Long-term memory + Memory Center | Working | memory engine | free (local embeddings); better with Ollama embeddings |
| 12 | Web research with citations | Working | search chain + fetch + research agent | Wikipedia free; SearXNG free self-host; Tavily free tier |
| 13 | Movie/video lookup (legal sources only) | Working | web tools | — |
| 14 | Browser automation | Planned | Phase 10 | Playwright |
| 15 | Shopping (confirmation mandatory) | Foundation | purchase tool gated, never trusted | store APIs |
| 16 | Email / messaging / calendar | Foundation | `email_draft` works; `email_send` gated + not configured | OAuth apps |
| 17 | Social media center | Planned | honest status panel | official APIs |
| 18, 49 | Content creation / Creator mode | Foundation | planning via conversation | MATA Studio |
| 19–20 | Website builder / coding agent | Planned | Phases 16–17 | sandbox |
| 21 | Multi-agent registry | Working | research/web/memory/planning/communication/security/vision ready; others planned | — |
| 22 | Tool registry (standard interface) | Working | schema, permission, risk, timeout, audit | — |
| 23 | Permission manager | Working | ALLOW/DENY/ASK/TEMPORARY/TRUSTED | — |
| 24, 55 | Confirmation engine, draft vs action | Working | pending actions, trusted rules, taint rule | — |
| 25–26 | Task automation / Automation Center | Working | scheduler, retries, history | — |
| 27 | File intelligence | Planned | Phase 27 | — |
| 31 | Local + cloud model abstraction | Working | providers + router with fallback | — |
| 32 | Hardware detection | Working | psutil + nvidia-smi → model advice | — |
| 33 | Command-center UI | Working | `/nexus` | — |
| 46 | TV / large display mode | Working (same machine) | `?display=tv` + BroadcastChannel | network sync planned |
| 47 | Mobile mode (responsive) | Working | responsive layout | phone-as-remote planned |
| 35, 57 | Developer dashboard, self-diagnostics | Working | System panel | — |
| 36–37 | Error recovery, observability | Working | provider fallback, structured tool errors, audit, feed, event traces | — |
| 38 | Plugin system | Foundation | integration/tool/agent registries | — |
| 39 | Event bus | Working | server `EventBus` + client `bus` | — |
| 45 | Robot abstraction | Foundation | `RobotController`, `SimulatedRobot` | — |
| 48 | Smart-home adapters | Foundation | `DeviceAdapter`, `DeviceRegistry` | — |
| 53 | Context management / no cross-user leaks | Working | scoped queries + tests | — |
| 54 | Prompt-injection defence | Working | fencing, scanning, taint gating | — |
| 56 | Action feed | Working | `nexus_action_events` + UI | — |
| 58–59 | Installation, Docker | Working | `scripts/nexus.sh`, compose service | — |

This table is updated at the end of every phase.
