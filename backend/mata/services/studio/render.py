"""Assemble a storyboard into a real .mp4 with ffmpeg.

Each scene becomes a clip: a still image with a Ken-Burns zoom (or, when AI animation
is enabled and kie.ai is configured, a real image→video clip), plus synthesized
narration. Clips are concatenated, subtitles optionally burned in, and an optional
AI-generated background track (kie.ai/Suno) mixed under the narration.

Robust by design: every external fetch retries and degrades (free provider → kie.ai →
local gradient placeholder); the final output is validated so a broken render never
returns a fake success.

ffmpeg/ffprobe must be on PATH (installed in the backend Docker image).
"""
from __future__ import annotations

import asyncio
import base64
import shutil
import uuid
from pathlib import Path

import httpx

from mata.services.image.providers import PollinationsImageProvider, get_image_provider
from mata.services.studio import kie, subtitles, voice
from mata.services.studio.brain import aspect_to_size

OUTPUT_DIR = Path(__file__).resolve().parents[3] / "_renders"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

_DIMS = {
    ("9:16", "720p"): (720, 1280),
    ("9:16", "1080p"): (1080, 1920),
    ("16:9", "720p"): (1280, 720),
    ("16:9", "1080p"): (1920, 1080),
    ("1:1", "720p"): (720, 720),
    ("1:1", "1080p"): (1080, 1080),
}
_FPS = 30


def dims(aspect_ratio: str, resolution: str) -> tuple[int, int]:
    return _DIMS.get((aspect_ratio, resolution), (1080, 1920))


async def _run(*args: str, cwd: str | None = None) -> None:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, cwd=cwd
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        tail = stderr.decode(errors="ignore")[-800:]
        raise RuntimeError(f"ffmpeg failed ({args[0]}): {tail}")


async def _ffprobe_duration(path: Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except (ValueError, AttributeError):
        return 0.0


def _placeholder_png(w: int, h: int, seed: int) -> bytes:
    """A deterministic vertical-gradient PNG, used when image providers are unavailable."""
    import struct
    import zlib

    c1 = ((seed * 53) % 200, (seed * 97) % 200, 120 + (seed * 31) % 100)
    c2 = ((seed * 17) % 80, (seed * 41) % 80, 40 + (seed * 13) % 60)
    rows = bytearray()
    for y in range(h):
        t = y / max(1, h - 1)
        rows.append(0)
        rows.extend(bytes((
            int(c1[0] + (c2[0] - c1[0]) * t),
            int(c1[1] + (c2[1] - c1[1]) * t),
            int(c1[2] + (c2[2] - c1[2]) * t),
        )) * w)

    def chunk(tag: bytes, data: bytes) -> bytes:
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(rows)))
        + chunk(b"IEND", b"")
    )


async def _save_source(src: str, path: Path) -> None:
    """Write a data URL or http(s) URL to disk (retries on 429/5xx)."""
    if src.startswith("data:"):
        _, _, b64 = src.partition(",")
        path.write_bytes(base64.b64decode(b64))
        return
    last: Exception | None = None
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
        for attempt in range(4):
            try:
                resp = await client.get(src)
                if resp.status_code in (429, 500, 502, 503, 504):
                    raise httpx.HTTPStatusError("transient", request=resp.request, response=resp)
                resp.raise_for_status()
                if not resp.content:
                    raise RuntimeError("empty body")
                path.write_bytes(resp.content)
                return
            except Exception as exc:  # noqa: BLE001
                last = exc
                await asyncio.sleep(1.5 * (attempt + 1))
    raise last or RuntimeError("download failed")


def _scene_prompt(scene: dict) -> str:
    return scene.get("prompt") or scene.get("visual") or scene.get("narracion") or "cinematic scene"


async def _ensure_image(scene: dict, aspect_ratio: str, work: Path, idx: int) -> tuple[Path, str | None]:
    """Return (local_png_path, public_url_or_None). public_url is needed for AI animation."""
    out = work / f"img_{idx:04d}.png"
    prompt = _scene_prompt(scene)
    size = aspect_to_size(aspect_ratio)
    public_url: str | None = None

    src = scene.get("image_url")
    if not src:
        try:
            src = (await get_image_provider().generate(prompt, size, 1, scene.get("style")))[0]
        except Exception:  # noqa: BLE001
            try:
                src = (await PollinationsImageProvider().generate(prompt, size, 1, scene.get("style")))[0]
            except Exception:  # noqa: BLE001
                src = None

    if src:
        try:
            await _save_source(src, out)
            if src.startswith("http"):
                public_url = src
        except Exception:  # noqa: BLE001
            out.unlink(missing_ok=True)

    # Backup: kie.ai image generation (reliable when free providers are down/limited).
    if not out.exists() and kie.kie_enabled():
        try:
            kurl = await kie.generate_image(prompt, aspect_ratio)
            await _save_source(kurl, out)
            public_url = kurl
        except Exception:  # noqa: BLE001
            pass

    # Last resort: gradient placeholder so the video still renders.
    if not out.exists():
        wstr, _, hstr = size.partition("x")
        out.write_bytes(_placeholder_png(int(wstr), int(hstr or wstr), idx + 1))
        public_url = None

    return out, public_url


async def _ensure_audio(scene: dict, voice_name: str, language: str, work: Path, idx: int) -> Path | None:
    text = (scene.get("narracion") or "").strip()
    if not text:
        return None
    data_url, _ = await voice.synthesize(text, voice_name, language)
    out = work / f"aud_{idx:04d}.mp3"
    _, _, b64 = data_url.partition(",")
    out.write_bytes(base64.b64decode(b64))
    return out


def _audio_args(aud: Path | None) -> tuple[list[str], list[str]]:
    """Input + map/codec args so EVERY clip carries an audio track (silence if none).
    Uniform streams keep the concat demuxer happy and let music be mixed later."""
    if aud:
        return ["-i", str(aud)], ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k"]
    return (
        ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"],
        ["-map", "0:v:0", "-map", "1:a:0", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest"],
    )


async def _build_kenburns_clip(img: Path, aud: Path | None, dur: float, w: int, h: int, out: Path) -> None:
    frames = max(1, int(dur * _FPS))
    vf = (
        f"scale={w*2}:{h*2}:force_original_aspect_ratio=increase,"
        f"zoompan=z='min(zoom+0.0007,1.12)':d={frames}:s={w}x{h}:fps={_FPS},"
        f"setsar=1,format=yuv420p"
    )
    ain, amap = _audio_args(aud)
    await _run(
        "ffmpeg", "-y", "-loop", "1", "-i", str(img), *ain,
        "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-r", str(_FPS), "-t", f"{dur:.3f}", "-movflags", "+faststart", *amap, str(out),
    )
    await _validate_clip(out)


async def _build_animated_clip(
    prompt: str, image_url: str, aud: Path | None, dur: float, w: int, h: int, out: Path, work: Path, idx: int
) -> None:
    """Real image→video via kie.ai (Kling), then fit to frame + narration."""
    kie_url = await kie.image_to_video(prompt, image_url, int(dur))
    raw = work / f"kie_{idx:04d}.mp4"
    await _save_source(kie_url, raw)
    vf = f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1,fps={_FPS},format=yuv420p"
    ain, amap = _audio_args(aud)
    await _run(
        "ffmpeg", "-y", "-stream_loop", "-1", "-i", str(raw), *ain,
        "-t", f"{dur:.3f}", "-vf", vf, "-c:v", "libx264", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-r", str(_FPS), "-movflags", "+faststart", *amap, str(out),
    )
    await _validate_clip(out)


async def _validate_clip(out: Path) -> None:
    if not out.exists() or out.stat().st_size < 1024 or await _ffprobe_duration(out) <= 0.05:
        raise RuntimeError(f"clip {out.name} produced no valid video")


async def render_project(
    scenes: list[dict],
    *,
    aspect_ratio: str,
    resolution: str,
    voice_name: str,
    language: str,
    burn_subtitles: bool,
    animate: bool = False,
    background_music: bool = False,
) -> dict:
    w, h = dims(aspect_ratio, resolution)
    job_id = uuid.uuid4().hex[:12]
    work = OUTPUT_DIR / f"work_{job_id}"
    work.mkdir(parents=True, exist_ok=True)
    use_kie_anim = animate and kie.kie_enabled()
    try:
        sem = asyncio.Semaphore(3)

        async def _assets(i: int, scene: dict):
            async with sem:
                img, url = await _ensure_image(scene, aspect_ratio, work, i)
                aud = await _ensure_audio(scene, voice_name, language, work, i)
                return i, img, url, aud

        prepared = await asyncio.gather(*(_assets(i, s) for i, s in enumerate(scenes)))

        clips: list[Path] = []
        for i, img, url, aud in sorted(prepared, key=lambda x: x[0]):
            dur = await _ffprobe_duration(aud) if aud else 0.0
            if dur <= 0.1:
                dur = float(scenes[i].get("duracion_seg") or 4)
            dur = min(max(dur + 0.4, 1.5), 60.0)
            clip = work / f"clip_{i:04d}.mp4"
            if use_kie_anim and url:
                try:
                    await _build_animated_clip(_scene_prompt(scenes[i]), url, aud, dur, w, h, clip, work, i)
                except Exception:  # noqa: BLE001 — animation failed, fall back to Ken-Burns
                    await _build_kenburns_clip(img, aud, dur, w, h, clip)
            else:
                await _build_kenburns_clip(img, aud, dur, w, h, clip)
            clips.append(clip)

        listfile = work / "list.txt"
        listfile.write_text("\n".join(f"file '{c.as_posix()}'" for c in clips), encoding="utf-8")
        out_name = f"video_{job_id}.mp4"
        out_path = OUTPUT_DIR / out_name

        if burn_subtitles:
            srt = work / "subs.srt"
            srt.write_text(subtitles.build(scenes, [str(s.get("narracion", "")) for s in scenes], "srt"), encoding="utf-8")
            style = "Fontsize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1"
            await _run(
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
                "-vf", f"subtitles=subs.srt:force_style='{style}'",
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-movflags", "+faststart", str(out_path), cwd=str(work),
            )
        else:
            await _run(
                "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listfile),
                "-c", "copy", "-movflags", "+faststart", str(out_path),
            )

        # Optional AI background music (kie.ai / Suno), mixed low under the narration.
        music_used = False
        if background_music and kie.kie_enabled():
            try:
                desc = scenes[0].get("musica") or _scene_prompt(scenes[0])
                murl = await kie.generate_music(str(desc))
                mp3 = work / "music.mp3"
                await _save_source(murl, mp3)
                mixed = OUTPUT_DIR / f"video_{job_id}_music.mp4"
                await _run(
                    "ffmpeg", "-y", "-i", str(out_path), "-stream_loop", "-1", "-i", str(mp3),
                    "-filter_complex", "[1:a]volume=0.18[m];[0:a][m]amix=inputs=2:duration=first[a]",
                    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac",
                    "-movflags", "+faststart", str(mixed),
                )
                if mixed.exists() and mixed.stat().st_size > 1024:
                    out_path.unlink(missing_ok=True)
                    out_path, out_name = mixed, mixed.name
                    music_used = True
            except Exception:  # noqa: BLE001 — music is optional
                pass

        total = await _ffprobe_duration(out_path)
        if not out_path.exists() or out_path.stat().st_size < 1024 or total <= 0.05:
            raise RuntimeError("final video is empty or invalid")

        return {
            "url": f"/files/{out_name}",
            "filename": out_name,
            "duration": round(total, 2),
            "scenes": len(clips),
            "resolution": f"{w}x{h}",
            "animated": use_kie_anim,
            "music": music_used,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
