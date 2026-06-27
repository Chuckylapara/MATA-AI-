"""Worker entrypoint: `SERVICE=video ROLE=worker python -m mata.worker`."""
from __future__ import annotations

import asyncio
import os

from mata.common.jobs import run_worker
from mata.services.music.providers import run_music
from mata.services.video.providers import run_video

_RUNNERS = {"video": run_video, "music": run_music}


def main() -> None:
    service = os.getenv("SERVICE", "video")
    runner = _RUNNERS.get(service)
    if runner is None:
        raise SystemExit(f"No worker runner for SERVICE={service!r}")
    asyncio.run(run_worker(service, runner))


if __name__ == "__main__":
    main()
