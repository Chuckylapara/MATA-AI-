"""Text-to-speech for scene narration.

Provider chain mirrors the rest of the platform (paid first, free fallback last):
  ElevenLabs (multilingual) > OpenAI TTS > Google Translate TTS (free, no key) > mock.

Every provider returns a base64 `data:audio/...` URL so the frontend can play and
download it directly, no storage needed.
"""
from __future__ import annotations

import base64
import urllib.parse

import httpx

from mata.common.config import settings

# Friendly voice names -> OpenAI voice ids (used when OpenAI is the active provider).
_OPENAI_VOICES = {
    "masculino": "onyx",
    "femenino": "nova",
    "nino": "shimmer",
    "anciano": "echo",
    "narrador": "fable",
    "cine": "onyx",
    "podcast": "alloy",
}


def _chunk_text(text: str, limit: int = 180) -> list[str]:
    """Split text on word boundaries into <=limit-char chunks (Google TTS limit)."""
    words = text.split()
    chunks: list[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + 1 > limit:
            if cur:
                chunks.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        chunks.append(cur)
    return chunks or [text[:limit]]


async def _elevenlabs(text: str) -> str:
    voice = settings.elevenlabs_voice_id
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice}",
            headers={"xi-api-key": settings.elevenlabs_api_key, "Accept": "audio/mpeg"},
            json={"text": text, "model_id": "eleven_multilingual_v2"},
        )
        resp.raise_for_status()
        return "data:audio/mpeg;base64," + base64.b64encode(resp.content).decode()


async def _openai(text: str, voice: str) -> str:
    model_voice = _OPENAI_VOICES.get(voice, "onyx")
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://api.openai.com/v1/audio/speech",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            json={"model": "gpt-4o-mini-tts", "voice": model_voice, "input": text},
        )
        resp.raise_for_status()
        return "data:audio/mpeg;base64," + base64.b64encode(resp.content).decode()


async def _google_free(text: str, language: str) -> str:
    """Free Google Translate TTS. Chunked, MP3 frames concatenated for playback."""
    lang = (language or "es").split("-")[0]
    chunks = _chunk_text(text)
    audio = b""
    headers = {"User-Agent": "Mozilla/5.0 (compatible; ViralAIStudio/1.0)"}
    async with httpx.AsyncClient(timeout=60, headers=headers) as client:
        for i, chunk in enumerate(chunks):
            url = (
                "https://translate.google.com/translate_tts?ie=UTF-8"
                f"&q={urllib.parse.quote(chunk)}&tl={lang}&client=tw-ob"
                f"&total={len(chunks)}&idx={i}&textlen={len(chunk)}"
            )
            resp = await client.get(url)
            resp.raise_for_status()
            audio += resp.content
    if not audio:
        raise RuntimeError("Google TTS returned no audio")
    return "data:audio/mpeg;base64," + base64.b64encode(audio).decode()


def _mock(text: str) -> str:
    """1s of silence (valid WAV) so the UI stays functional with no provider."""
    import struct

    sample_rate, secs = 8000, 1
    n = sample_rate * secs
    data = b"\x00\x00" * n
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16)
    header += b"data" + struct.pack("<I", len(data))
    return "data:audio/wav;base64," + base64.b64encode(header + data).decode()


async def _url_to_data_url(url: str) -> str:
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        return "data:audio/mpeg;base64," + base64.b64encode(resp.content).decode()


async def synthesize(text: str, voice: str, language: str) -> tuple[str, str]:
    """Return (data_url, provider_name). Degrades gracefully through the chain.

    When kie.ai is configured it is preferred (premium ElevenLabs voice); otherwise
    direct ElevenLabs/OpenAI keys, then free Google TTS, then a silent placeholder.
    """
    from mata.services.studio import kie

    text = text.strip()
    if not text:
        return _mock(text), "mock"
    if kie.kie_enabled():
        try:
            return await _url_to_data_url(await kie.generate_voice(text, language=language)), "kie-elevenlabs"
        except Exception:  # noqa: BLE001
            pass
    if settings.elevenlabs_api_key and settings.elevenlabs_voice_id:
        try:
            return await _elevenlabs(text), "elevenlabs"
        except Exception:  # noqa: BLE001
            pass
    if settings.openai_api_key:
        try:
            return await _openai(text, voice), "openai"
        except Exception:  # noqa: BLE001
            pass
    try:
        return await _google_free(text, language), "google-free"
    except Exception:  # noqa: BLE001
        return _mock(text), "mock"
