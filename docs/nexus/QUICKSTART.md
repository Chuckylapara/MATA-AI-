# NEXUS — Quickstart

## Requirements
- Python 3.11+, Node 20+ (22 recommended for `npm run test:nexus`)
- A Chromium-based browser (Chrome/Edge) or Safari for voice recognition. Firefox works for
  text, avatar and vision but has no SpeechRecognition.
- Optional: [Ollama](https://ollama.com) for free local models, or any provider key.

## Five commands
```bash
./scripts/nexus.sh install     # venv + pip + npm
./scripts/nexus.sh configure   # creates .env (random JWT secret)
./scripts/nexus.sh start       # backend :8000 (all services) + frontend :3000
./scripts/nexus.sh test        # 62 backend tests + typecheck + frontend unit tests
./scripts/nexus.sh build       # production static build of the frontend
./scripts/nexus.sh e2e         # browser end-to-end smoke test (needs `start` running)
```
Open **http://localhost:3000/nexus**, create an account at `/login`, and talk.

## Give NEXUS a brain (pick one)
Without a provider NEXUS runs in **dev-mock mode**: the UI, voice, avatar, memory, tasks and
tools all work, but replies are labelled `[DEV MOCK — no AI provider configured]`.

| Option | Cost | Set in `.env` |
|---|---|---|
| Ollama (local, private) | free | `OLLAMA_BASE_URL=http://localhost:11434/v1` then `ollama pull llama3.1:8b nomic-embed-text` |
| NVIDIA NIM | free dev credits | `NVIDIA_API_KEY=` |
| Groq | free tier | `GROQ_API_KEY=` |
| Google Gemini | free tier | `GEMINI_API_KEY=` |
| Anthropic Claude | paid | `ANTHROPIC_API_KEY=` |

Restart `start` after editing `.env`. Check **System** in the sidebar: `ai_provider` should be READY.

## Better web search (optional)
Wikipedia works out of the box. For general web search add a self-hosted SearXNG
(`SEARXNG_URL`) or a Tavily key (1,000 free searches/month).

## Docker
`docker compose up --build` now includes a `nexus` service on port 8014 behind the gateway.

## TV / large display
Open `/nexus/?display=tv` in a second window on the TV/monitor attached to the same PC: it
shows only the avatar and captions and mirrors the main window's state, voice level and
motion (BroadcastChannel). Cross-device display over the network is planned.
