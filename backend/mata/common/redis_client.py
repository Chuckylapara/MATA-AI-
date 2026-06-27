"""Redis connection + token-bucket rate limiter + simple job queue.

When settings.dev_inmemory is true (local dev without Docker), Redis is replaced by
in-process structures. This only works in a single process — fine for the dev server.
"""
from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict, deque

from mata.common.config import settings

_pool = None

# --- In-memory fallbacks (single-process dev) ---
_mem_counters: dict[str, tuple[int, float]] = {}
_mem_queues: dict[str, deque] = defaultdict(deque)
_mem_events: dict[str, asyncio.Event] = defaultdict(asyncio.Event)


def get_redis():
    global _pool
    if _pool is None:
        import redis.asyncio as redis

        _pool = redis.from_url(settings.redis_url, decode_responses=True)
    return _pool


async def rate_limit(key: str, limit_per_min: int) -> bool:
    """Fixed-window limiter. Returns True if allowed."""
    if settings.dev_inmemory:
        now = time.time()
        count, window_start = _mem_counters.get(key, (0, now))
        if now - window_start >= 60:
            count, window_start = 0, now
        count += 1
        _mem_counters[key] = (count, window_start)
        return count <= limit_per_min

    r = get_redis()
    window_key = f"rl:{key}"
    count = await r.incr(window_key)
    if count == 1:
        await r.expire(window_key, 60)
    return count <= limit_per_min


# --- Minimal job queue (for async generation workers) ---
async def enqueue(queue: str, payload: dict) -> None:
    if settings.dev_inmemory:
        _mem_queues[queue].append(payload)
        _mem_events[queue].set()
        return
    r = get_redis()
    await r.lpush(f"queue:{queue}", json.dumps(payload))


async def dequeue(queue: str, timeout: int = 5) -> dict | None:
    if settings.dev_inmemory:
        if _mem_queues[queue]:
            return _mem_queues[queue].popleft()
        try:
            await asyncio.wait_for(_mem_events[queue].wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return None
        _mem_events[queue].clear()
        return _mem_queues[queue].popleft() if _mem_queues[queue] else None
    r = get_redis()
    item = await r.brpop(f"queue:{queue}", timeout=timeout)
    if item is None:
        return None
    _, raw = item
    return json.loads(raw)
