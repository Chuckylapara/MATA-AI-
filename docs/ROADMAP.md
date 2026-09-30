# NEXUS — Roadmap

Legend: ✅ done & tested · 🟡 foundation built, more to do · ⏳ planned · ⛔ intentionally not built

Rule for every phase: run tests → inspect errors → fix → re-test previous features → update
docs → commit a stable milestone. Never move on with broken functionality.

| Phase | Scope | Status |
|---|---|---|
| 0 | Research + architecture (`docs/*`) | ✅ |
| 1 | Foundation: nexus service, DB entities, event bus, model provider abstraction, tool registry, permissions, confirmation engine, audit/action feed, hardware detection, diagnostics, integrations registry, robot abstraction | ⏳ |
| 2 | Futuristic UI: `/nexus` command center, sidebar, display (TV) mode, mobile layout | ⏳ |
| 3 | Avatar engine: Three.js particle humanoid per reference image, 16 states, breathing/idle/head/eyes/mouth | ⏳ |
| 4 | Voice: 4a Web Speech STT/TTS, VAD, barge-in, lip-sync, device selection · 4b Silero VAD + Whisper + Kokoro local pipeline | ⏳ |
| 5 | AI orchestration: context engine, SSE turn loop, tool calling, confirmation flow | ⏳ |
| 6 | Memory: typed memories, embeddings, hybrid retrieval, consolidation, expiry, Memory Center | ⏳ |
| 7 | Vision: camera permission + indicator, "what am I looking at", OCR via VLM | ⏳ |
| 8 | Motion tracking: MediaPipe pose/hands/face → avatar mirroring with One-Euro smoothing | ⏳ |
| 9 | Web intelligence: search provider chain, fetch/extract, research reports with citations | ⏳ |
| 10 | Browser agent (Playwright, permitted sites only) | ⏳ |
| 11 | Tool system: plugin loading, UI for tools, per-tool trusted rules | ⏳ |
| 12 | Communication: Gmail/Calendar/Contacts/Telegram plugins, draft → confirm → send | ⏳ |
| 13 | Social media control center (official APIs) | ⏳ |
| 14 | Shopping: search/compare, cart, confirmed purchase only | ⏳ |
| 15 | Content creation / Creator mode (reuse MATA Studio) | ⏳ |
| 16 | Website builder agent (sandboxed) | ⏳ |
| 17 | Coding agent (sandboxed container, destructive commands gated) | ⏳ |
| 18 | Automation: scheduler, recurring tasks, monitors, retries | ⏳ |
| 19 | Security hardening: Alembic migrations, secret scanning in CI, encrypted integration tokens, pen-test checklist | ⏳ |
| 20 | Performance: particle LOD, worker threads for tracking, provider latency budgets | ⏳ |
| 21 | Production packaging: Docker service, desktop wrapper (Tauri) evaluation | ⏳ |

⛔ Not built by design: bypassing DRM/paywalls, personal-account automation that platforms
forbid (e.g. unofficial WhatsApp), silent purchases/messages, covert biometric identification.
