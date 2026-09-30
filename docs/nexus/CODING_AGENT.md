# NEXUS — Coding & website agents

**Status: planned (Phases 16–17).** Both appear as `planned` agents.

Design: work happens in a sandboxed container with a copy of the project; tools for reading,
editing, running tests/builds and analysing errors. Destructive commands (delete, force-push,
drop database, deploy) are HIGH risk and require confirmation. Secrets are never printed or
committed (`redact_secrets` + secret scanning). Preferred stack for generated sites:
TypeScript/React/Next.js/Node/PostgreSQL/Docker unless the project calls for something else.
