# NEXUS — Technology Research

Research date: **2026-09-30**. Prices and free tiers change often; re-verify before relying
on them commercially. 💲 = paid (or requires a card), 🆓 = free / open source.

Selection rules (from the spec): prefer open source, local, free tiers, official &
documented APIs, stable libraries, consumer hardware. Anything paid sits behind an
abstraction so a free/local provider can replace it.

---

## 1. Frontend rendering (avatar)

| Tech | What / why | License | Price | Limits | HW | Alternatives | Maintenance |
|---|---|---|---|---|---|---|---|
| **Three.js** (chosen) | WebGL/WebGPU engine; renders the particle avatar with custom GLSL shaders | MIT | 🆓 | Needs WebGL2; we cap particles by device tier | Any GPU from ~2015; iGPU OK at ~60k particles | Babylon.js (Apache-2.0), raw WebGL, PlayCanvas | Very active (monthly releases, r18x) |
| React Three Fiber | React bindings for Three | MIT | 🆓 | Extra abstraction | same | plain Three | Active — **not used**: imperative Three keeps the render loop out of React reconciliation (lower latency). |
| Rive / Lottie | 2D vector animation | MIT | 🆓 | 2D only; cannot match the volumetric reference | — | — | Rejected for the avatar. |

**Why particles instead of a rigged glTF human?** The reference image is a luminous point/
line cloud, not a skinned mesh. A procedural particle body gives the look directly, lets
every state (thinking, searching, speaking) be a shader uniform change, and is retargetable
(bones = particle groups) for motion mirroring. A glTF/VRM body can be added later through
the same `AvatarRig` interface.

## 2. Voice

| Tech | Role | License | Price | Limits | HW | API | Status |
|---|---|---|---|---|---|---|---|
| **Web Speech API – SpeechRecognition** (Phase 4a, chosen) | Streaming STT with interim results | Browser built-in | 🆓 | Chrome/Edge send audio to the vendor's cloud; Firefox lacks it; needs network in Chrome | none | W3C draft | Stable in Chromium/Safari |
| **Web Speech API – speechSynthesis** (chosen) | TTS with word-boundary events (drives lip-sync) | Browser built-in | 🆓 | Voice quality varies by OS | none | W3C | Stable |
| **Silero VAD** via `@ricky0123/vad-web` (Phase 4b) | Accurate voice-activity detection / barge-in in the browser (ONNX) | Model MIT, lib ISC | 🆓 | ~2 MB model, WASM | any | npm | Active; supports Silero v5 |
| **Whisper** (faster-whisper / whisper.cpp) (Phase 4b) | Local, private STT | MIT | 🆓 | Streaming requires chunking; large-v3 needs ~6 GB VRAM, small runs on CPU | CPU OK (small), GPU for large | local HTTP | Active |
| Groq Whisper API (already in repo) | Fast cloud STT | Proprietary | 🆓 tier / 💲 | Rate-limited | none | REST | Active |
| **Kokoro-82M** / `kokoro-js` (Phase 4b) | High-quality local TTS, runs in browser (WebGPU/WASM) or server | Apache-2.0 weights | 🆓 | ~80–300 MB download; no voice cloning | WebGPU ideal, WASM OK | npm / Python | Active |
| ElevenLabs (already in repo) | Premium expressive TTS | Proprietary | 💲 (small free tier) | Credits | none | REST/WS | Optional plugin |
| Piper | Fast local TTS (C++) | MIT (older) / GPL (newer) | 🆓 | Robotic vs. Kokoro | CPU | local | Check license per version |

Echo handling: `getUserMedia({ echoCancellation: true, noiseSuppression: true,
autoGainControl: true })` + ignoring STT results while our own TTS audio energy dominates
(Phase 4a), true AEC reference comes with the WebRTC/WebSocket pipeline (Phase 4b).

## 3. Vision / motion

| Tech | Role | License | Price | Notes |
|---|---|---|---|---|
| **MediaPipe Tasks Vision** `@mediapipe/tasks-vision` (chosen) | Pose (33 landmarks + world coords), Hand (21×2), Face (478 + blendshapes + head transform) | Apache-2.0 | 🆓 | On-device WASM + GPU delegate; ~30 fps on laptops. Models (~5–30 MB) fetched from Google storage/CDN. Actively maintained (1.0.x in 2026). |
| TensorFlow.js MoveNet / BlazePose | Pose alternative | Apache-2.0 | 🆓 | Pose only |
| Tesseract.js | Browser OCR | Apache-2.0 | 🆓 | Slower, good for documents — Phase 7b |
| Cloud VLM (NVIDIA NIM Llama-3.2-Vision, Claude, Gemini) | "What am I looking at?", scene/product understanding, OCR by LLM | Proprietary APIs | 🆓 tiers (NIM, Gemini) / 💲 | Frame only sent on explicit user request |
| Local VLM via Ollama (Qwen2.5-VL, Llama 3.2 Vision, Gemma 3) | Private scene understanding | Model-specific (mostly permissive) | 🆓 | Needs ~8 GB VRAM for good latency |

Smoothing: **One-Euro filter** (Casiez et al., 2012) per landmark channel — the standard
low-latency jitter filter for tracking; implemented in-repo (~40 lines, no dependency).

## 4. Language models (see `AI_MODEL_STRATEGY.md`)

| Provider | Type | Price | Notes |
|---|---|---|---|
| **Ollama** | Local runtime, OpenAI-compatible `/v1/chat/completions` and `/v1/embeddings` | 🆓 MIT | Best local option; hardware-dependent |
| NVIDIA NIM (build.nvidia.com) | Cloud, OpenAI-compatible | 🆓 dev credits | Already used by MATA |
| Groq | Cloud, OpenAI-compatible, very fast | 🆓 tier / 💲 | Good "fast" role |
| Google Gemini | Cloud | 🆓 tier / 💲 | Already used by MATA; vision capable |
| Anthropic Claude | Cloud; strong tool use & reasoning | 💲 | Default "reasoning" role when configured |
| OpenAI | Cloud | 💲 | Optional |

## 5. Memory / storage

| Tech | Role | License | Price | Notes |
|---|---|---|---|---|
| PostgreSQL 16 (existing) | Primary DB | PostgreSQL | 🆓 | Prod |
| SQLite + aiosqlite (existing dev) | Local DB | Public domain | 🆓 | Single-PC mode |
| **pgvector** | Vector index in Postgres | PostgreSQL | 🆓 | Enable when memories > ~50k/user |
| **sqlite-vec** | Vector search in SQLite | MIT/Apache | 🆓 | Actively maintained again in 2026; single-PC scale-up path |
| In-process cosine over JSON vectors (chosen now) | Zero-dependency retrieval | — | 🆓 | O(n) per query; fine for personal scale (≤ tens of thousands of memories) |
| Redis (existing) | Rate limit, queues, event fan-out | BSD/RSAL | 🆓 | Optional in dev |

Embeddings: provider embeddings (Ollama `nomic-embed-text` 768-d, OpenAI, Gemini) when
configured; otherwise a **local hashed n-gram embedding** (deterministic, offline, 256-d)
so semantic-ish retrieval works with zero setup. It is clearly weaker than a neural model
and reported as such in diagnostics.

## 6. Web intelligence

| Provider | Price | Notes |
|---|---|---|
| **Wikipedia / MediaWiki REST API** (built-in) | 🆓 | Official, documented, keyless; encyclopedic topics only |
| **SearXNG** (self-hosted) | 🆓 AGPL | Metasearch, no limits except upstream rate limits; best free general search |
| Tavily | 🆓 1,000/mo, then 💲 | AI-oriented results with extracted content |
| Brave Search API | 💲 — free tier removed Feb 2026 (≈$5 monthly credit, card required) | High-quality independent index |
| Exa / Firecrawl / Serper | 💲 with trial credits | Alternatives |
| Page fetch + readability extraction (built-in) | 🆓 | `httpx` + HTML-to-text; respects robots/ToS by design (no login walls, no paywall bypass) |

The web agent uses a **provider chain**: configured providers first, Wikipedia last; if all
fail the user is told exactly which provider failed and why.

## 7. Browser automation

| Tech | License | Notes |
|---|---|---|
| **Playwright** (Phase 10) | Apache-2.0 | Chromium is available in the dev container; used only where a site permits automation and no API exists. Runs server-side in an isolated context, never with the user's real cookies unless explicitly connected. |
| Puppeteer | Apache-2.0 | Chromium-only alternative |

## 8. Communication / social / shopping / creation (plugins, later phases)

All are **integrations** that report `NOT CONFIGURED` until credentials exist:

| Area | Official APIs | Price | Notes |
|---|---|---|---|
| Email / Calendar / Contacts | Gmail API, Google Calendar API, People API (OAuth); Microsoft Graph | 🆓 with OAuth app verification | Send = HIGH risk → confirmation |
| Messaging | Telegram Bot API 🆓; WhatsApp Business Cloud API (Meta, per-conversation 💲); Twilio SMS 💲 | | Personal WhatsApp automation is not permitted — not implemented |
| Social | YouTube Data API 🆓 quota; Instagram Graph API (business accounts); TikTok Content Posting API (approval needed); X API 💲 | | Publish = HIGH risk |
| Shopping | Amazon PA-API (affiliate approval), Shopify Storefront API, eBay Browse API 🆓 | | Purchase always requires confirmation |
| Images | HF Inference FLUX (existing, 🆓 tier), Replicate 💲, local SDXL/FLUX via ComfyUI 🆓 | | |
| Video | existing MATA Studio pipeline; Replicate / kie.ai 💲 | | Never claims success without an output URL |

## 9. Infrastructure

| Tech | Why |
|---|---|
| Docker / docker-compose (existing) | One image for all services; `nexus` adds one service |
| psutil (BSD) | CPU/RAM/disk/network detection |
| `nvidia-smi` (if present) | GPU/VRAM detection; falls back gracefully |
| pytest + pytest-asyncio | Backend tests |
| Playwright (Phase 10/E2E) | Browser tests |

## Sources

- MediaPipe Tasks Vision: https://www.npmjs.com/package/@mediapipe/tasks-vision ,
  https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Silero VAD / vad-web: https://github.com/ricky0123/vad , https://github.com/snakers4/silero-vad
- Kokoro: https://huggingface.co/hexgrad/Kokoro-82M , https://www.npmjs.com/package/kokoro-js
- sqlite-vec: https://github.com/asg017/sqlite-vec/releases
- Ollama OpenAI compatibility: https://docs.ollama.com/api/openai-compatibility
- Brave Search API pricing change: https://www.implicator.ai/brave-drops-free-search-api-tier-puts-all-developers-on-metered-billing/
- Tavily / SearXNG comparison: https://www.firecrawl.dev/blog/tavily-alternatives
