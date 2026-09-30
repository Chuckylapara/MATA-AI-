# NEXUS — Automation

**Status: working.** Code: `backend/mata/nexus/scheduler.py`. UI: Tasks / Automations.

| Kind | What it really does |
|---|---|
| reminder | creates a notification + feed entry |
| web_search | runs `web_search`, stores top results as a notification |
| monitor_url | fetches a public page and notifies when its content hash changes |

Each task has a schedule (once at/in N minutes, or every N ≥ 15 minutes), timezone, retry policy
(exponential backoff 2^attempt min), timeout, status (active/paused/completed/failed), full run
history and audit rows. Create by voice ("Recuérdame llamar a mamá en una hora") or from the UI;
pause, resume, run now, delete. The scheduler polls every 30 s (`NEXUS_SCHEDULER=0` disables it).

Planned: daily reports, cron expressions, multi-step automations.
