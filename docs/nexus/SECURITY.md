# NEXUS — Security

Full model: **[../SECURITY_MODEL.md](../SECURITY_MODEL.md)**. Implemented controls:

- Per-user isolation on every query; tested (`test_no_cross_user_leak`, `test_other_user_cannot_touch_my_data`).
- Permission manager (ALLOW / DENY / ASK / TEMPORARY / TRUSTED) per capability.
- Confirmation engine: HIGH risk always asks unless a matching trusted rule exists; never after
  consuming untrusted content in the same turn; never for purchases.
- Prompt-injection defence: `<untrusted_data>` fencing, fence-escape neutralisation, instruction
  pattern flags, policy in the system prompt.
- JSON-schema validation of tool arguments, size limits, per-tool timeouts.
- SSRF guard on page fetches; GET-only.
- Secret redaction in audit/feed; no keys in the frontend; `.env` git-ignored.
- Full audit log (Security panel).

Pending for Phase 19: Alembic migrations, encrypted OAuth token storage, CI secret scanning, rate
limits on `/nexus/converse` beyond the gateway's per-tier limits.
