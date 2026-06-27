"""Single entrypoint: `SERVICE=<name> uvicorn run:app`.

Selects which service app to expose based on the SERVICE env var. This lets every
microservice share one Docker image — only the SERVICE/PORT env differs.
"""
from __future__ import annotations

import importlib
import os

SERVICE = os.getenv("SERVICE", "gateway")

_MODULES = {
    "devserver": "mata.services.devserver.app",
    "gateway": "mata.services.gateway.app",
    "auth": "mata.services.auth.app",
    "chat": "mata.services.chat.app",
    "image": "mata.services.image.app",
    "video": "mata.services.video.app",
    "music": "mata.services.music.app",
    "code": "mata.services.code.app",
    "agent": "mata.services.agent.app",
    "billing": "mata.services.billing.app",
    "admin": "mata.services.admin.app",
}

if SERVICE not in _MODULES:
    raise SystemExit(f"Unknown SERVICE={SERVICE!r}. Options: {', '.join(_MODULES)}")

app = importlib.import_module(_MODULES[SERVICE]).app
