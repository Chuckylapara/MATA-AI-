"""Cut, vertically reframe (9:16) and caption a single highlight into a short clip.

Reframe modes:
  * "center" — scale-fill + centre crop. Fast, always works.
  * "face"   — sample frames, detect the speaker's face with OpenCV and crop around
               them (static smart-crop). Falls back to centre when no face is found
               or OpenCV isn't installed.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from mata.services.studio.render import _ffprobe_duration, _run

_OUT_W, _OUT_H = 1080, 1920  # 9:16 vertical
_CAPTION_STYLE = (
    "Fontname=Arial,Fontsize=16,Bold=1,PrimaryColour=&H00FFFFFF,"
    "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=120"
)


async def _probe_dims(path: Path) -> tuple[int, int]:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    out, _ = await proc.communicate()
    try:
        w, h = out.decode().strip().split("x")
        return int(w), int(h)
    except (ValueError, AttributeError):
        return (1920, 1080)


def _ts(seconds: float) -> str:
    ms = int(round(max(0.0, seconds) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def clip_srt(segments: list[dict], start: float, end: float) -> str:
    """SRT for the part of the transcript inside [start, end], offset to clip time."""
    lines: list[str] = []
    n = 1
    for s in segments:
        if s["end"] <= start or s["start"] >= end:
            continue
        a = max(s["start"], start) - start
        b = min(s["end"], end) - start
        if b - a < 0.2:
            continue
        lines.append(f"{n}\n{_ts(a)} --> {_ts(b)}\n{s['text']}\n")
        n += 1
    return "\n".join(lines)


async def _face_center_x(video: Path, start: float, dur: float, work: Path) -> float:
    """Best-effort normalized (0..1) horizontal centre of the speaker. 0.5 = centre."""
    try:
        import cv2  # type: ignore
    except ImportError:
        return 0.5

    frames_dir = work / "faceframes"
    frames_dir.mkdir(exist_ok=True)
    # Sample 1 frame every ~2s of the clip (cap at 15) to find the face position.
    fps = min(0.5, 15 / max(dur, 1))
    try:
        await _run(
            "ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(video),
            "-vf", f"fps={fps},scale=320:-1", str(frames_dir / "f_%03d.jpg"),
        )
    except Exception:  # noqa: BLE001
        return 0.5

    def _detect() -> float:
        cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
        centers: list[float] = []
        for f in sorted(frames_dir.glob("f_*.jpg")):
            img = cv2.imread(str(f))
            if img is None:
                continue
            gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, 1.2, 5, minSize=(30, 30))
            if len(faces):
                x, _, fw, _ = max(faces, key=lambda r: r[2] * r[3])
                centers.append((x + fw / 2) / img.shape[1])
        if not centers:
            return 0.5
        centers.sort()
        return centers[len(centers) // 2]  # median

    try:
        return await asyncio.to_thread(_detect)
    except Exception:  # noqa: BLE001
        return 0.5


def _crop_geometry(src_w: int, src_h: int, center_x: float) -> tuple[int, int, int, int]:
    """Largest 9:16 window inside the source, horizontally centred on center_x."""
    crop_w = min(src_w, int(src_h * _OUT_W / _OUT_H))
    crop_h = min(src_h, int(crop_w * _OUT_H / _OUT_W))
    crop_w -= crop_w % 2
    crop_h -= crop_h % 2
    x = int(center_x * src_w - crop_w / 2)
    x = max(0, min(x, src_w - crop_w))
    y = max(0, (src_h - crop_h) // 2)
    return crop_w, crop_h, x, y


async def make_clip(
    source: Path,
    *,
    start: float,
    end: float,
    idx: int,
    work: Path,
    out_dir: Path,
    out_name: str,
    reframe: str,
    burn_subtitles: bool,
    segments: list[dict],
) -> dict:
    dur = max(1.0, end - start)
    src_w, src_h = await _probe_dims(source)

    center_x = 0.5
    if reframe == "face":
        center_x = await _face_center_x(source, start, dur, work)
    crop_w, crop_h, cx, cy = _crop_geometry(src_w, src_h, center_x)

    vf = f"crop={crop_w}:{crop_h}:{cx}:{cy},scale={_OUT_W}:{_OUT_H},setsar=1"

    sub_path: Path | None = None
    if burn_subtitles:
        srt = clip_srt(segments, start, end)
        if srt.strip():
            sub_path = work / f"sub_{idx:03d}.srt"
            sub_path.write_text(srt, encoding="utf-8")
            vf += f",subtitles={sub_path.name}:force_style='{_CAPTION_STYLE}'"

    out_path = out_dir / out_name
    await _run(
        "ffmpeg", "-y", "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(source),
        "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out_path),
        cwd=str(work),  # so the relative subtitles= path resolves
    )
    real = await _ffprobe_duration(out_path)
    if not out_path.exists() or out_path.stat().st_size < 1024 or real <= 0.1:
        raise RuntimeError(f"clip {idx} produced no valid video")
    return {"filename": out_name, "duration": round(real, 2)}
