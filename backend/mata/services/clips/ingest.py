"""Get a long source video onto disk — from a URL (yt-dlp) or a direct upload.

Supports YouTube, Twitch VODs and Kick (anything yt-dlp can resolve). Live streams
are not supported (use a recorded VOD). Downloads are capped at 1080p to keep the
worker fast and disk usage sane.
"""
from __future__ import annotations

import asyncio
import shutil
import sys
from pathlib import Path

# Reuse the platform's hardened ffprobe helper.
from mata.services.studio.render import _ffprobe_duration

# Hard limits so a single job can't exhaust the host.
MAX_SOURCE_SECONDS = 4 * 60 * 60   # reject sources longer than 4 hours
SUPPORTED_HINTS = ("youtube.com", "youtu.be", "twitch.tv", "kick.com")


class IngestError(RuntimeError):
    """Raised when a source video can't be obtained."""


async def _run_capture(*args: str) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
    )
    out, _ = await proc.communicate()
    return proc.returncode or 0, out.decode(errors="ignore")


async def fetch_from_url(url: str, dest_dir: Path) -> Path:
    """Download a video URL to dest_dir/source.mp4 via yt-dlp. Raises IngestError."""
    if shutil.which("yt-dlp") is not None:
        base = ["yt-dlp"]
    else:
        # Fall back to the module entrypoint, using THIS interpreter (not a stray
        # "python" on PATH that may not have yt-dlp installed).
        base = [sys.executable, "-m", "yt_dlp"]

    out_tmpl = str(dest_dir / "source.%(ext)s")
    args = [
        *base,
        "-f", "bv*[height<=1080]+ba/b[height<=1080]/b",
        "--merge-output-format", "mp4",
        "--no-playlist",
        "--no-warnings",
        "--retries", "3",
        "-o", out_tmpl,
        url,
    ]
    code, log = await _run_capture(*args)
    if code != 0:
        tail = log[-600:]
        raise IngestError(f"No se pudo descargar el video. {tail}")

    # yt-dlp may produce source.mp4 or source.mkv/webm depending on the merge.
    candidates = sorted(dest_dir.glob("source.*"), key=lambda p: p.stat().st_size, reverse=True)
    if not candidates:
        raise IngestError("La descarga no produjo ningún archivo de video.")
    src = candidates[0]

    dur = await _ffprobe_duration(src)
    if dur <= 0:
        raise IngestError("El archivo descargado no es un video válido.")
    if dur > MAX_SOURCE_SECONDS:
        src.unlink(missing_ok=True)
        raise IngestError(f"El video es demasiado largo ({dur/3600:.1f} h). Máximo {MAX_SOURCE_SECONDS//3600} h.")
    return src


async def save_upload(file_bytes_path: Path, dest_dir: Path) -> Path:
    """Validate an already-saved upload and return its path (or raise IngestError)."""
    dur = await _ffprobe_duration(file_bytes_path)
    if dur <= 0:
        raise IngestError("El archivo subido no es un video válido.")
    if dur > MAX_SOURCE_SECONDS:
        raise IngestError(f"El video es demasiado largo ({dur/3600:.1f} h).")
    return file_bytes_path
