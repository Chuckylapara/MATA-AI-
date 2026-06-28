"""Build SRT / VTT subtitles from a storyboard's scenes.

Timings come from each scene's `duracion_seg` (cumulative). Narration can be
translated to a target language via the LLM brain; falls back to the original text.
"""
from __future__ import annotations

from mata.common.llm import LLMUnavailable, generate_json

LANGS = {
    "es": "español",
    "en": "inglés",
    "fr": "francés",
    "pt": "portugués",
    "de": "alemán",
    "it": "italiano",
}


def _ts(seconds: float, *, vtt: bool) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    sep = "." if vtt else ","
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def build(scenes: list[dict], lines: list[str], fmt: str) -> str:
    vtt = fmt == "vtt"
    out: list[str] = ["WEBVTT", ""] if vtt else []
    t = 0.0
    for i, scene in enumerate(scenes):
        dur = float(scene.get("duracion_seg") or 3)
        start, end = t, t + dur
        t = end
        text = (lines[i] if i < len(lines) else scene.get("narracion", "")).strip()
        if not vtt:
            out.append(str(i + 1))
        out.append(f"{_ts(start, vtt=vtt)} --> {_ts(end, vtt=vtt)}")
        out.append(text)
        out.append("")
    return "\n".join(out).strip() + "\n"


async def translate(lines: list[str], target_lang: str) -> list[str]:
    """Translate narration lines to target_lang. Returns originals on any failure."""
    lang_name = LANGS.get(target_lang, target_lang)
    prompt = (
        f"Traduce al {lang_name} cada elemento de esta lista JSON de líneas de narración. "
        "Devuelve SOLO un array JSON de strings, mismo orden y misma longitud.\n\n"
        f"{lines}"
    )
    try:
        result = await generate_json(
            system="Eres un traductor profesional de subtítulos.",
            prompt=prompt,
            temperature=0.3,
        )
        if isinstance(result, dict):
            result = result.get("lineas") or result.get("lines") or next(iter(result.values()), [])
        if isinstance(result, list) and len(result) == len(lines):
            return [str(x) for x in result]
    except (LLMUnavailable, ValueError, Exception):  # noqa: BLE001
        pass
    return lines
