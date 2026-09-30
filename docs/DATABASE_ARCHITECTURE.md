# NEXUS — Database Architecture

NEXUS shares the existing MATA database (PostgreSQL in prod, SQLite in dev) and reuses the
existing `users`, `refresh_tokens`, `conversations` and `messages` tables. New tables are
prefixed `nexus_` so they never collide with existing modules.

## Entity map

```
users (existing) 1──1 nexus_profiles
      │
      ├──* nexus_memories          (type, content, embedding, importance, tags, expires_at)
      ├──* nexus_permissions       (capability, mode, expires_at)  UNIQUE(user_id, capability)
      ├──* nexus_trusted_rules     (tool, constraints JSON, enabled)
      ├──* nexus_pending_actions   (tool, args, risk, status, preview, expires_at)
      ├──* nexus_tasks             (kind, schedule, timezone, status, retry, timeout, next_run_at)
      │      └──* nexus_task_runs  (status, started_at, finished_at, output, error)
      ├──* nexus_projects          (name, status, summary)
      │      └──* nexus_memories.project_id (nullable FK)
      ├──* nexus_action_events     (feed: kind, message, data, created_at)
      ├──* nexus_audit_logs        (actor, action, target, risk, outcome, data)
      ├──* nexus_notifications
      ├──* nexus_integrations      (plugin id, status, scopes — tokens encrypted, never returned)
      └──* conversations/messages (existing, reused for NEXUS threads, title prefixed)
```

Spec entities → implementation:

| Spec entity | Table |
|---|---|
| User, Session | `users`, `refresh_tokens` (existing) |
| Conversation, Message | existing tables |
| Memory | `nexus_memories` |
| Preference | `nexus_profiles.preferences` (JSON) + `preference` memories |
| Task, Automation | `nexus_tasks`, `nexus_task_runs` |
| Permission | `nexus_permissions`, `nexus_trusted_rules` |
| Tool, Agent | code registries (static, versioned with code) exposed via API — not DB rows |
| Integration, SocialAccount | `nexus_integrations` (kind = social/email/…) |
| Document, File | `nexus_documents` (Phase 6b/27) |
| Project | `nexus_projects` |
| AuditLog | `nexus_audit_logs` |
| Notification | `nexus_notifications` |

## Indexes

- `(user_id, created_at)` on memories, action events, audit logs, task runs.
- `(user_id, type)` on memories; `(user_id, capability)` unique on permissions.
- `(status, next_run_at)` on tasks (scheduler polling).
- `(user_id, status)` on pending actions.

## Vectors

`nexus_memories.embedding` is JSON (`list[float]`) + `embedding_model` so vectors from
different models are never compared. Scale path: Postgres → `pgvector` column + HNSW index;
SQLite → `sqlite-vec` virtual table. The memory engine's scorer is the only code that changes.

## Migrations

The existing platform creates tables with `Base.metadata.create_all` at startup (dev). NEXUS
tables follow that for Phase 1 so single-PC mode works with zero steps. Before production
(Phase 19) an Alembic baseline covering all tables is generated (`alembic` is already a
dependency) and `create_all` is disabled when `ENVIRONMENT=production`.

## Retention

- Memories: optional `expires_at`; consolidation merges near-duplicates; `short_term` memories
  expire after 24 h by default.
- Action events: 30 days. Audit logs: 180 days (configurable). Task runs: last 100 per task.
