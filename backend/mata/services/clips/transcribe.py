"""Transcribe a video's audio into timestamped segments.

Provider preference (OpenAI-compatible Whisper):
    Groq (fast, cheap)  >  OpenAI  >  local faster-whisper  >  error.

Long audio is split into ~10-minute chunks and the segment timestamps are offset so
the result is continuous regardless of source length.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import httpx

from mata.common.config import settings
from mata.services.studio.render import _ffprobe_duration, _run

CHUNK_SECONDS = 600  # 10 min per Whisper request (keeps each upload well under 25 MB)


class TranscribeError(RuntimeError):
    pass


def _provider() -> tuple[str, str] | None:
    """Return (base_url, api_key) for an OpenAI-compatible STT, or None."""
    if settings.groq_api_key:
        return "https://api.groq.com/openai/v1", settings.groq_api_key
    if settings.openai_api_key:
        return "https://api.openai.com/v1", settings.openai_api_key
    return None


async def _extract_audio(video: Path, work: Path) -> Path:
    """16 kHz mono mp3 — smallest payload that keeps Whisper accuracy."""
    audio = work / "audio.mp3"
    await _run(
        "ffmpeg", "-y", "-i", str(video), "-vn",
        "-ac", "1", "-ar", "16000", "-b:a", "64k", str(audio),
    )
    return audio


async def _slice_audio(audio: Path, start: float, dur: float, work: Path, idx: int) -> Path:
    out = work / f"chunk_{idx:03d}.mp3"
    await _run(
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}",
        "-i", str(audio), "-c", "copy", str(out),
    )
    return out


async def _whisper_api(chunk: Path, base_url: str, api_key: str) -> list[dict]:
    model = settings.whisper_model if "groq" in base_url else "whisper-1"
    data = {"model": model, "response_format": "verbose_json"}
    async with httpx.AsyncClient(timeout=300) as client:
        with chunk.open("rb") as fh:
            resp = await client.post(
                f"{base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {api_key}"},
                data=data,
                files={"file": (chunk.name, fh, "audio/mpeg")},
            )
        resp.raise_for_status()
        body = resp.json()
    return [
        {"start": float(s["start"]), "end": float(s["end"]), "text": (s.get("text") or "").strip()}
        for s in body.get("segments", [])
        if (s.get("text") or "").strip()
    ]


async def _transcribe_local(audio: Path) -> list[dict]:
    """Optional local fallback using faster-whisper if it's installed."""
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError as exc:  # noqa: BLE001
        raise TranscribeError(
            "No hay proveedor de transcripción. Configura GROQ_API_KEY u OPENAI_API_KEY "
            "(o instala faster-whisper)."
        ) from exc

    def _run_sync() -> list[dict]:
        model = WhisperModel("base", device="cpu", compute_type="int8")
        segments, _ = model.transcribe(str(audio))
        return [
            {"start": float(s.start), "end": float(s.end), "text": s.text.strip()}
            for s in segments
            if s.text.strip()
        ]

    return await asyncio.to_thread(_run_sync)


async def transcribe(video: Path, work: Path) -> dict:
    """Return {'segments': [{start,end,text}], 'text': str}. Raises TranscribeError."""
    audio = await _extract_audio(video, work)
    total = await _ffprobe_duration(audio)

    provider = _provider()
    segments: list[dict] = []

    if provider is None:
        segments = await _transcribe_local(audio)
    else:
        base_url, api_key = provider
        offset = 0.0
        idx = 0
        while offset < total:
            dur = min(CHUNK_SECONDS, total - offset)
            chunk = await _slice_audio(audio, offset, dur, work, idx)
            try:
                part = await _whisper_api(chunk, base_url, api_key)
            except Exception as exc:  # noqa: BLE001
                raise TranscribeError(f"Fallo al transcribir: {str(exc)[:300]}") from exc
            for s in part:
                segments.append({"start": s["start"] + offset, "end": s["end"] + offset, "text": s["text"]})
            chunk.unlink(missing_ok=True)
            offset += dur
            idx += 1

    if not segments:
        raise TranscribeError("No se detectó habla en el video.")
    return {"segments": segments, "text": " ".join(s["text"] for s in segments)}
