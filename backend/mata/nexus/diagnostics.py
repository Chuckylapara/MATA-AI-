"""Self-diagnostics: READY / WARNING / ERROR per subsystem."""
from __future__ import annotations

import asyncio
import os
import shutil
import socket

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from mata.nexus.embeddings import LOCAL_MODEL, Embedder
from mata.nexus.integrations import list_integrations
from mata.nexus.router import ModelRouter
from mata.nexus.tools.web import provider_chain

READY, WARNING, ERROR = "READY", "WARNING", "ERROR"


def _check(name: str, status: str, detail: str, fix: str | None = None) -> dict:
    return {"name": name, "status": status, "detail": detail, **({"fix": fix} if fix else {})}


async def _dns_ok() -> bool:
    try:
        await asyncio.wait_for(asyncio.to_thread(socket.getaddrinfo, "wikipedia.org", 443), timeout=3)
        return True
    except (OSError, asyncio.TimeoutError):
        return False


async def run_diagnostics(db: AsyncSession, router: ModelRouter) -> dict:
    checks: list[dict] = []

    p = router.primary("reasoning")
    if p is None:
        checks.append(_check("ai_provider", ERROR, "No model provider available.",
                             "Set OLLAMA_BASE_URL or a provider key (NVIDIA_API_KEY, GROQ_API_KEY, GEMINI_API_KEY…)."))
    elif p.name == "mock":
        checks.append(_check("ai_provider", WARNING, "Using the DEV MOCK placeholder — not a real AI.",
                             "Configure Ollama (local) or a cloud provider key."))
    else:
        checks.append(_check("ai_provider", READY, f"reasoning={p.name} ({p.model_for('reasoning')})"))

    try:
        await db.execute(text("SELECT 1"))
        checks.append(_check("database", READY, db.bind.dialect.name if db.bind else "ok"))
    except Exception as exc:  # noqa: BLE001
        checks.append(_check("database", ERROR, str(exc)[:200]))

    emb = Embedder(router).model_id
    checks.append(_check("memory", WARNING if emb == LOCAL_MODEL else READY,
                         f"embeddings={emb}",
                         "Install Ollama + nomic-embed-text for neural embeddings." if emb == LOCAL_MODEL else None))

    v = router.primary("vision")
    checks.append(_check("vision_ai", READY if v else WARNING,
                         f"vision={v.name}" if v else "No vision model; on-device tracking still works.",
                         None if v else "Configure Anthropic, Gemini, NVIDIA or an Ollama VLM."))
    checks.append(_check("voice", READY, "Browser speech (Web Speech API) — verified client-side."))
    checks.append(_check("camera", READY, "Client-side (MediaPipe); requires user permission each session."))

    chain = provider_chain()
    names = [c.name for c in chain]
    checks.append(_check("web_search", READY if len(names) > 1 else WARNING, f"providers={names}",
                         None if len(names) > 1 else "Only Wikipedia is available. Add SEARXNG_URL or TAVILY_API_KEY."))
    checks.append(_check("browser", WARNING, "Browser automation agent is planned (phase 10)."))

    ints = list_integrations()
    configured = [i["id"] for i in ints if i["configured"]]
    checks.append(_check("integrations", READY, f"{len(configured)}/{len(ints)} configured: {configured}"))

    du = shutil.disk_usage(os.path.abspath(os.sep))
    free_gb = du.free / 2**30
    checks.append(_check("storage", READY if free_gb > 2 else WARNING, f"{free_gb:.1f} GB free"))
    online = await _dns_ok()
    checks.append(_check("network", READY if online else WARNING,
                         "DNS resolution OK" if online else "Cannot resolve external hosts (offline?)"))
    gpu = shutil.which("nvidia-smi")
    checks.append(_check("gpu", READY if gpu else WARNING,
                         "NVIDIA GPU tools present" if gpu else "No NVIDIA GPU detected — cloud or CPU models."))

    overall = ERROR if any(c["status"] == ERROR for c in checks) else (
        WARNING if any(c["status"] == WARNING for c in checks) else READY)
    return {"overall": overall, "checks": checks}
