"""Hardware detection → local-model recommendations. Degrades gracefully."""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import time

try:
    import psutil
except ImportError:  # pragma: no cover
    psutil = None


def _gpus() -> list[dict]:
    gpus: list[dict] = []
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total,memory.used,utilization.gpu",
                 "--format=csv,noheader,nounits"], capture_output=True, text=True, timeout=5).stdout
            for line in out.strip().splitlines():
                name, total, used, util = [x.strip() for x in line.split(",")]
                gpus.append({"vendor": "nvidia", "name": name, "vram_total_mb": int(float(total)),
                             "vram_used_mb": int(float(used)), "utilization_pct": float(util)})
        except (subprocess.SubprocessError, ValueError, OSError):
            pass
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        gpus.append({"vendor": "apple", "name": "Apple Silicon (unified memory)", "vram_total_mb": None})
    return gpus


def detect() -> dict:
    info: dict = {
        "os": {"system": platform.system(), "release": platform.release(), "machine": platform.machine(),
               "python": platform.python_version()},
        "cpu": {"model": platform.processor() or platform.machine(), "logical_cores": os.cpu_count()},
        "gpus": _gpus(), "psutil": psutil is not None, "ts": time.time(),
    }
    if psutil:
        vm = psutil.virtual_memory()
        du = psutil.disk_usage(os.path.abspath(os.sep))
        net = psutil.net_io_counters()
        info["cpu"].update({"physical_cores": psutil.cpu_count(logical=False),
                            "usage_pct": psutil.cpu_percent(interval=0.1)})
        info["ram"] = {"total_mb": vm.total // 2**20, "available_mb": vm.available // 2**20, "used_pct": vm.percent}
        info["storage"] = {"total_gb": round(du.total / 2**30, 1), "free_gb": round(du.free / 2**30, 1),
                           "used_pct": du.percent}
        info["network"] = {"bytes_sent": net.bytes_sent, "bytes_recv": net.bytes_recv,
                           "interfaces_up": [n for n, s in psutil.net_if_stats().items() if s.isup]}
    info["recommendation"] = recommend(info)
    return info


def recommend(info: dict) -> dict:
    ram_gb = (info.get("ram", {}).get("total_mb") or 0) / 1024
    vram_gb = max([(g.get("vram_total_mb") or 0) / 1024 for g in info.get("gpus", [])] or [0])
    apple = any(g["vendor"] == "apple" for g in info.get("gpus", []))
    if vram_gb >= 24:
        tier, models = "high", {"reasoning": "qwen2.5:32b", "fast": "llama3.1:8b", "vision": "qwen2.5vl:7b",
                                "embeddings": "nomic-embed-text"}
    elif vram_gb >= 10:
        tier, models = "upper-mid", {"reasoning": "qwen2.5:14b", "fast": "llama3.1:8b", "vision": "qwen2.5vl:7b",
                                     "embeddings": "nomic-embed-text"}
    elif vram_gb >= 6 or (apple and ram_gb >= 16):
        tier, models = "mid", {"reasoning": "llama3.1:8b", "fast": "qwen2.5:3b", "vision": "moondream",
                               "embeddings": "nomic-embed-text"}
    elif ram_gb >= 16:
        tier, models = "cpu", {"fast": "qwen2.5:3b", "embeddings": "nomic-embed-text",
                               "reasoning": "cloud provider recommended"}
    else:
        tier, models = "low", {"all": "cloud providers recommended; local hashed embeddings for memory"}
    particles = 90000 if vram_gb >= 6 or apple else (60000 if ram_gb >= 8 else 30000)
    return {"tier": tier, "ollama_models": models, "avatar_particle_budget": particles,
            "note": "Advice only — NEXUS never downloads models automatically."}
