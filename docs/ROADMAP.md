# NEXUS — Roadmap

Legend: ✅ done & tested · 🟡 foundation built, more to do · ⏳ planned · ⛔ intentionally not built

Rule for every phase: run tests → inspect errors → fix → re-test previous features → update
docs → commit a stable milestone. Never move on with broken functionality.

Verification at this milestone: 63 backend tests (pytest), 5 frontend unit tests, a Playwright
end-to-end test, TypeScript typecheck, and a production `next build` all pass.

| Phase | Scope | Status |
|---|---|---|
| 0 | Research + architecture (`docs/*`) | ✅ |
| 1 | Foundation: nexus service, DB entities, event bus, model provider abstraction, tool registry, permissions, confirmation engine, audit/action feed, hardware detection, diagnostics, integrations registry, robot abstraction | ✅ |
| 2 | Futuristic UI: `/nexus` command center, sidebar, captions, action feed, TV display mode (same machine), mobile layout | ✅ · 🟡 cross-device display/remote over the network |
| 3 | Avatar engine: Three.js particle humanoid per reference image, 16 states, breathing, blinking, gaze, lip-sync, idle/conversational motion, bloom, quality tiers | ✅ · 🟡 autonomous hand gestures without tracking |
| 4 | Voice: 4a Web Speech STT/TTS, energy VAD, barge-in with echo rejection, local stop words, lip-sync, device selection | ✅ 4a · ⏳ 4b Silero VAD + Whisper + Kokoro local pipeline |
| 5 | AI orchestration: context engine, SSE turn loop, planner + tool calling, confirmation flow, provider fallback | ✅ |
| 6 | Memory: typed memories, embeddings, hybrid retrieval, dedupe, consolidation, expiry, extraction, Memory Center | ✅ · 🟡 LLM-based extraction, pgvector/sqlite-vec index |
| 7 | Vision: camera permission + indicator, "what am I looking at", OCR via VLM | ✅ (needs a vision provider) |
| 8 | Motion tracking: MediaPipe pose/hands/face → avatar mirroring with One-Euro smoothing | ✅ (not verifiable in CI without a camera — manual check required) |
| 9 | Web intelligence: search provider chain, SSRF-safe fetch/extract, research agent with citations | ✅ |
| 10 | Browser agent (Playwright, permitted sites only) | ⏳ |
| 11 | Tool system: registry, schema validation, timeouts, audit, trusted rules | ✅ · ⏳ dynamic plugin loading + per-plugin UI |
| 12 | Communication: Gmail/Calendar/Contacts/Telegram plugins | 🟡 drafts + gated `email_send` stub · ⏳ integrations |
| 13 | Social media control center (official APIs) | ⏳ (panel shows honest status) |
| 14 | Shopping: search/compare, cart, confirmed purchase only | 🟡 purchase gating enforced · ⏳ store APIs |
| 15 | Content creation / Creator mode (reuse MATA Studio) | 🟡 planning via conversation · ⏳ generation tools |
| 16 | Website builder agent (sandboxed) | ⏳ |
| 17 | Coding agent (sandboxed container, destructive commands gated) | ⏳ |
| 18 | Automation: scheduler, reminders, recurring searches, page monitors, retries, history | ✅ · ⏳ reports, cron expressions |
| 19 | Security hardening: Alembic migrations, secret scanning in CI, encrypted integration tokens, converse rate limits | ⏳ |
| 20 | Performance: particle LOD by hardware, tracking in a worker, provider latency budgets | ⏳ |
| 21 | Production packaging: Docker service ✅, desktop wrapper (Tauri) evaluation ⏳ | 🟡 |

⛔ Not built by design: bypassing DRM/paywalls/logins, personal-account automation that platforms
forbid (e.g. unofficial WhatsApp), silent purchases/messages, covert biometric identification.

## Environment notes
In the cloud container used to build this milestone, outbound access to `wikipedia.org` and
`open-meteo.com` was blocked by the network policy; those tools were verified to fail
honestly (exact error surfaced, no fabricated results) and are covered by mocked tests.
They work on a normal internet connection.
