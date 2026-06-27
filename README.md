# Mata AI

A modular, multi-functional AI platform (ChatGPT-style, but expandable). Mata AI bundles
nine products behind one API-first gateway:

1. **Chat Assistant** – streaming natural conversation
2. **Image Generator** – text-to-image
3. **Video Generator** – text-to-video (async job architecture)
4. **Music Generator** – text-to-music (async job architecture)
5. **Code Generator** – code synthesis + explanation
6. **Agent System** – autonomous task automation with tool/API calling
7. **Admin Dashboard** – users, usage, revenue, moderation
8. **Auth** – JWT (access + refresh), RBAC
9. **Billing** – Stripe subscriptions, freemium + premium tiers, credit engine

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

```
                         ┌──────────────┐
   Next.js frontend ───► │   Gateway    │ ──► routes /auth, /chat, /image, ...
                         │  (FastAPI)   │
                         └──────┬───────┘
        ┌───────────────┬───────┼────────┬───────────────┬──────────────┐
     auth            chat     image     video/music     code           agent
        │               │        │          │             │              │
        └───────────────┴────────┴──────────┴─────────────┴──────────────┘
                              PostgreSQL + Redis
```

Every service shares the `mata.common` package (config, DB models, security, credit engine)
but runs as its own container, so you can extract any service later without rewrites.

## Quick start

```bash
cp .env.example .env          # edit secrets (optional: add provider API keys)
docker compose up --build     # starts db, redis, all services, frontend
```

Then open:

- Frontend: http://localhost:3000
- Gateway / OpenAPI docs: http://localhost:8000/docs
- Admin API: http://localhost:8000/admin (login as the seeded admin)

Seeded admin: `admin@mata.ai` / `admin12345` (change in production).

### Run a single service for development

```bash
cd backend
pip install -r requirements.txt
SERVICE=chat uvicorn run:app --reload --port 8002
```

## Provider keys (optional)

All generative modules run with deterministic **mock** providers out of the box.
Add real keys in `.env` to switch to live providers:

```
ANTHROPIC_API_KEY=...     # chat, code, agent
OPENAI_API_KEY=...        # image (DALL·E) fallback
REPLICATE_API_TOKEN=...   # image / video / music
STRIPE_SECRET_KEY=...     # billing
```

## License

Proprietary – startup product scaffold.
