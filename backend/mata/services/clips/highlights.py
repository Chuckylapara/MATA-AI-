"""Pick the most viral-worthy moments out of a transcript using the LLM brain.

For long sources (streams of several hours) the transcript is processed in windows so
it never blows the context limit; candidates are then merged, de-overlapped and ranked.
Falls back to an even split if no LLM provider is configured.
"""
from __future__ import annotations

from mata.common.llm import LLMUnavailable, generate_json

WINDOW_CHARS = 12_000  # ~ a few thousand tokens of transcript per LLM call


def _fmt_window(segments: list[dict]) -> str:
    return "\n".join(f"[{s['start']:.1f}] {s['text']}" for s in segments)


def _windows(segments: list[dict]) -> list[list[dict]]:
    out: list[list[dict]] = []
    cur: list[dict] = []
    size = 0
    for s in segments:
        cur.append(s)
        size += len(s["text"]) + 12
        if size >= WINDOW_CHARS:
            out.append(cur)
            cur, size = [], 0
    if cur:
        out.append(cur)
    return out


async def _ask_window(window: list[dict], target_min: int, target_max: int, language: str) -> list[dict]:
    lo, hi = window[0]["start"], window[-1]["end"]
    system = (
        "Eres un editor experto en clips virales para TikTok, Reels y Shorts. "
        "Recibes una transcripción con marcas de tiempo en segundos. Identifica los "
        "momentos con mayor potencial viral: ganchos, frases impactantes, picos de emoción, "
        "humor, controversia o valor sorprendente."
    )
    prompt = (
        f"Transcripción (cada línea: [segundo] texto), entre {lo:.1f}s y {hi:.1f}s:\n\n"
        f"{_fmt_window(window)}\n\n"
        f"Devuelve un JSON con la clave \"clips\": una lista de los mejores momentos. "
        f"Cada elemento: {{\"start\": número (segundos), \"end\": número (segundos), "
        f"\"title\": título corto y llamativo, \"score\": entero 1-10}}. "
        f"Cada clip debe durar entre {target_min} y {target_max} segundos, empezar en un gancho "
        f"y terminar en una idea completa. start/end deben estar dentro del rango dado. "
        f"Título en {language}. Máximo 5 clips por respuesta."
    )
    data = await generate_json(system=system, prompt=prompt, temperature=0.4, max_tokens=1500)
    items = data.get("clips", data) if isinstance(data, dict) else data
    out = []
    for it in items or []:
        try:
            start, end = float(it["start"]), float(it["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start or start < lo - 1 or end > hi + 1:
            continue
        out.append({
            "start": start,
            "end": end,
            "title": str(it.get("title") or "Momento destacado")[:120],
            "score": int(it.get("score", 5)) if str(it.get("score", "")).strip().lstrip("-").isdigit() else 5,
        })
    return out


def _snap(value: float, segments: list[dict], *, to_end: bool) -> float:
    """Snap a time to the nearest segment boundary so cuts land on sentence edges."""
    best = value
    bestd = 1e9
    for s in segments:
        b = s["end"] if to_end else s["start"]
        d = abs(b - value)
        if d < bestd:
            bestd, best = d, b
    return best


def _dedupe(cands: list[dict], num: int, tmin: int, tmax: int) -> list[dict]:
    cands = sorted(cands, key=lambda c: c["score"], reverse=True)
    chosen: list[dict] = []
    for c in cands:
        dur = c["end"] - c["start"]
        if dur < tmin:
            c["end"] = c["start"] + tmin
        elif dur > tmax:
            c["end"] = c["start"] + tmax
        if any(not (c["end"] <= o["start"] or c["start"] >= o["end"]) for o in chosen):
            continue  # overlaps an already-picked clip
        chosen.append(c)
        if len(chosen) >= num:
            break
    return sorted(chosen, key=lambda c: c["start"])


def _even_split(segments: list[dict], num: int, target: int) -> list[dict]:
    total = segments[-1]["end"]
    step = max(target, total / max(num, 1))
    out = []
    t = 0.0
    i = 1
    while t < total and len(out) < num:
        out.append({"start": t, "end": min(t + target, total), "title": f"Clip {i}", "score": 5})
        t += step
        i += 1
    return out


async def find_highlights(
    segments: list[dict],
    *,
    num_clips: int,
    target_min: int,
    target_max: int,
    language: str = "es",
) -> list[dict]:
    target = (target_min + target_max) // 2
    candidates: list[dict] = []
    try:
        for window in _windows(segments):
            candidates.extend(await _ask_window(window, target_min, target_max, language))
    except LLMUnavailable:
        return _even_split(segments, num_clips, target)
    except Exception:  # noqa: BLE001 — never let highlight picking kill the job
        candidates = []

    if not candidates:
        return _even_split(segments, num_clips, target)

    picked = _dedupe(candidates, num_clips, target_min, target_max)
    # Snap to segment boundaries for clean cuts.
    for c in picked:
        c["start"] = max(0.0, _snap(c["start"], segments, to_end=False))
        c["end"] = _snap(c["end"], segments, to_end=True)
        if c["end"] - c["start"] < target_min:
            c["end"] = c["start"] + target_min
    return picked or _even_split(segments, num_clips, target)
