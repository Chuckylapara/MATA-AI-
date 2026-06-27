# Mata AI — System Architecture

## 1. Design goals

| Goal | Decision |
|------|----------|
| API-first | Every capability is an HTTP/JSON endpoint; the frontend is just one client. |
| Modular & expandable | Each AI capability is an isolated service behind a gateway. New module = new service + one gateway route. |
| Microservices-ready | Services are separate apps/containers sharing a `mata.common` core. No service imports another service's internals — they talk over HTTP. |
| Scalable | Stateless services (scale horizontally), Postgres for state, Redis for cache/queue/rate-limit, async job model for heavy generation. |
| Secure | JWT access+refresh tokens, bcrypt password hashing, RBAC, per-tier rate limits, server-side credit metering. |
| Cloud / Docker-ready | One parametrized Docker image; docker-compose for local; the same image deploys to ECS/Cloud Run/K8s. |

## 2. Component map

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend (3000)                       │
│   chat UI · image studio · video/music · code · agent · admin · billing │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ HTTPS (Bearer JWT)
┌───────────────────────────────▼───────────────────────────────────────┐
│                          API Gateway (8000)                            │
│  · routing & reverse-proxy   · JWT verification   · rate limiting      │
│  · request id / logging      · CORS               · credit pre-check   │
└───┬───────┬────────┬────────┬────────┬────────┬────────┬────────┬──────┘
    │       │        │        │        │        │        │        │
 ┌──▼──┐ ┌──▼──┐ ┌───▼──┐ ┌───▼──┐ ┌──▼──┐ ┌───▼──┐ ┌───▼───┐ ┌──▼───┐
 │auth │ │chat │ │image │ │video │ │music│ │ code │ │ agent │ │billing│
 │8001 │ │8002 │ │8003  │ │8004  │ │8005 │ │8006  │ │ 8007  │ │ 8008 │
 └──┬──┘ └──┬──┘ └───┬──┘ └───┬──┘ └──┬──┘ └───┬──┘ └───┬───┘ └──┬───┘
    └───────┴────────┴────────┴───────┴────────┴────────┴────────┘
                                 │
                  ┌──────────────┴───────────────┐
                  │                              │
            ┌─────▼──────┐                ┌──────▼──────┐
            │ PostgreSQL │                │   Redis     │
            │  (state)   │                │ cache/queue │
            └────────────┘                └─────────────┘
```

`admin` is exposed through the gateway under `/admin` and is guarded by the `admin` role.

## 3. Why a shared `mata.common` core (and not full physical separation yet)

A pre-revenue startup shouldn't pay the operational tax of N independently-deployed,
independently-schema'd microservices on day one. So:

- **Logical microservices now:** each service is a separate FastAPI `app`, its own
  container/port, scaled independently, fronted by the gateway. They never import each
  other — only `mata.common`.
- **Physical split later:** when a service needs its own release cadence or datastore,
  copy it out, give it its own DB, and point the gateway at the new URL. Nothing else changes.

This is the "modular monolith → microservices" migration path, kept honest by the rule
*services communicate only over HTTP*.

## 4. Request lifecycle

1. Frontend calls `POST /chat/completions` with `Authorization: Bearer <access_token>`.
2. **Gateway** verifies the JWT, applies the tier rate limit (Redis token bucket),
   attaches `X-User-Id`/`X-User-Tier`, and proxies to the `chat` service.
3. **Chat service** loads the conversation, runs a **credit pre-authorization** against the
   user's balance (`mata.common.credits`), calls the provider adapter (Anthropic or mock),
   streams tokens back, then **settles** the actual credit cost.
4. Usage is written to the `usage_events` table — the source of truth for the admin
   dashboard and billing overage.

## 5. Data model (PostgreSQL)

- `users` — identity, hashed password, role, tier, credit balance.
- `refresh_tokens` — rotating refresh tokens (revocable).
- `conversations` / `messages` — chat history.
- `generations` — image/video/music/code outputs + async job status.
- `agent_runs` / `agent_steps` — agent task traces (tool calls, observations).
- `subscriptions` — Stripe subscription mirror (tier, status, period end).
- `usage_events` — every metered action (module, credits, tokens, cost).

## 6. Async generation (video/music/long image jobs)

Heavy generation is **non-blocking**:

```
client ──POST /video/jobs──► service ──enqueue──► Redis queue
                                  └─► returns {job_id, status: "queued"}
worker ──dequeue──► provider ──► store result ──► update generations.status="succeeded"
client ──GET /video/jobs/{id}──► poll status / result url
```

The same pattern powers music and large image batches. Workers are the same image run with
`SERVICE=<module> ROLE=worker`.

## 7. Monetization / credit engine

| Tier | Price | Monthly credits | Rate limit | Models |
|------|-------|-----------------|------------|--------|
| Free | $0 | 100 | 20 req/min | base models |
| Pro | $20/mo | 5,000 | 120 req/min | all models |
| Business | $99/mo | 30,000 + overage | 600 req/min | all + priority |

- Each module declares a **credit cost** per unit (e.g. chat = 1 credit / 1k tokens,
  image = 5 credits, video = 200 credits).
- `credits.authorize()` reserves credits before work; `credits.settle()` adjusts to the
  real cost; failures auto-refund the reservation.
- Stripe webhooks (`billing` service) grant/reset monthly credits and flip tiers.

## 8. Security

- Passwords: bcrypt (`passlib`).
- Tokens: short-lived access JWT (15 min) + rotating refresh JWT (30 days) stored hashed.
- RBAC: `require_role("admin")` dependency; tier gating on premium models.
- Transport: TLS terminated at the load balancer in production.
- Secrets: env vars / secret manager — never committed.
- Input: Pydantic validation everywhere; output moderation hook in chat/image.

## 9. Scaling & deployment

- Every service is stateless → horizontal autoscaling.
- Postgres: managed (RDS / Cloud SQL) with read replicas for the admin analytics queries.
- Redis: managed (ElastiCache / Memorystore).
- One Docker image, `SERVICE` env selects the app; deploy as N services on
  ECS Fargate / Cloud Run / K8s Deployments behind the gateway.
- Observability: structured JSON logs + `/healthz` on every service + request-id propagation.

## 10. Adding a new module (the expandability promise)

1. Create `backend/mata/services/<name>/app.py` exposing `app` and a router.
2. Implement a provider adapter in `providers.py` (real + mock).
3. Register the credit cost in `mata/common/credits.py`.
4. Add one route entry in the gateway's `SERVICE_MAP`.
5. Add a container to `docker-compose.yml`.

No other service changes. That is the whole point of the design.
