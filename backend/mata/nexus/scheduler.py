"""Task automation runner: schedules, retries with backoff, timeouts, execution history.

Supported kinds (real implementations):
  reminder     → notification + action feed entry
  web_search   → runs the web_search tool, stores results
  monitor_url  → fetches a public page, notifies when its content changes
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from mata.nexus.audit import audit, feed
from mata.nexus.events import EventName, bus
from mata.nexus.models import NexusNotification, NexusTask, NexusTaskRun, TaskStatus

log = logging.getLogger("nexus.scheduler")
POLL_SECONDS = 30


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


async def _execute(db: AsyncSession, task: NexusTask) -> dict:
    if task.kind == "reminder":
        db.add(NexusNotification(user_id=task.user_id, title=f"Reminder: {task.title}", body=task.params.get("note")))
        return {"notified": True}
    if task.kind == "web_search":
        from mata.nexus.embeddings import Embedder
        from mata.nexus.memory import MemoryEngine
        from mata.nexus.router import get_router
        from mata.nexus.tools.base import ToolContext
        from mata.nexus.tools.registry import executor

        router = get_router()
        ctx = ToolContext(db=db, user_id=task.user_id, router=router,
                          memory=MemoryEngine(db, task.user_id, Embedder(router)))
        res = await executor.run(ctx, "web_search", {"query": task.params.get("query") or task.title},
                                 actor="scheduler")
        if not res.ok:
            raise RuntimeError(res.error or "search failed")
        top = [{"title": r["title"], "url": r["url"]} for r in res.data["results"][:5]]
        db.add(NexusNotification(user_id=task.user_id, title=f"Search results: {task.title}",
                                 body="\n".join(f"{r['title']} — {r['url']}" for r in top)))
        return {"results": top}
    if task.kind == "monitor_url":
        from mata.nexus.tools.web import fetch_page

        url = task.params.get("url")
        if not url:
            raise ValueError("monitor_url task requires params.url")
        page = await fetch_page(url, max_chars=200_000)
        if not page.get("ok"):
            raise RuntimeError(page.get("error") or "fetch failed")
        digest = hashlib.sha256(page["text"].encode()).hexdigest()
        changed = task.params.get("last_hash") not in (None, digest)
        task.params = {**task.params, "last_hash": digest}
        if changed:
            db.add(NexusNotification(user_id=task.user_id, title=f"Page changed: {task.title}", body=url))
        return {"changed": changed, "hash": digest[:12]}
    raise ValueError(f"Unknown task kind '{task.kind}'")


def _reschedule(task: NexusTask, ok: bool, attempt: int) -> None:
    sched = task.schedule or {}
    if not ok and attempt <= task.max_retries:
        task.next_run_at = _now() + timedelta(minutes=2 ** attempt)
        task.params = {**task.params, "_attempt": attempt}
        return
    task.params = {k: v for k, v in task.params.items() if k != "_attempt"}
    if sched.get("type") == "interval":
        task.next_run_at = _now() + timedelta(minutes=int(sched.get("every_minutes", 60)))
    else:
        task.status = TaskStatus.completed if ok else TaskStatus.failed
        task.next_run_at = None


async def run_task(db: AsyncSession, task: NexusTask) -> NexusTaskRun:
    attempt = int(task.params.get("_attempt", 0)) + 1
    run = NexusTaskRun(task_id=task.id, user_id=task.user_id, status="running", attempt=attempt)
    db.add(run)
    await bus.publish(EventName.TASK_STARTED, task.user_id, task_id=task.id)
    try:
        output = await asyncio.wait_for(_execute(db, task), timeout=task.timeout_s)
        run.status, run.output = "succeeded", output
        ok = True
        await bus.publish(EventName.TASK_COMPLETED, task.user_id, task_id=task.id)
        await feed(db, user_id=task.user_id, kind="task", message=f"Task completed: {task.title}")
    except Exception as exc:  # noqa: BLE001 — record, retry, never crash the loop
        run.status, run.error = "failed", (str(exc) or type(exc).__name__)[:1000]
        ok = False
        await bus.publish(EventName.TASK_FAILED, task.user_id, task_id=task.id, error=run.error)
        await feed(db, user_id=task.user_id, kind="task_failed", message=f"Task failed: {task.title} — {run.error}")
    run.finished_at = _now()
    task.last_run_at = run.finished_at
    _reschedule(task, ok, attempt)
    await audit(db, user_id=task.user_id, actor="scheduler", action=f"task:{task.kind}", target=task.id,
                outcome="ok" if ok else "failed", data={"attempt": attempt, "error": run.error})
    await db.flush()
    return run


async def run_due(session_factory: async_sessionmaker) -> int:
    async with session_factory() as db:
        res = await db.execute(select(NexusTask).where(
            NexusTask.status == TaskStatus.active, NexusTask.next_run_at.is_not(None),
            NexusTask.next_run_at <= _now()).limit(20))
        tasks = list(res.scalars())
        for task in tasks:
            await run_task(db, task)
        await db.commit()
        return len(tasks)


async def scheduler_loop(session_factory: async_sessionmaker) -> None:
    log.info("NEXUS scheduler started (poll %ss)", POLL_SECONDS)
    while True:
        try:
            await run_due(session_factory)
        except Exception:  # noqa: BLE001
            log.exception("scheduler iteration failed")
        await asyncio.sleep(POLL_SECONDS)
