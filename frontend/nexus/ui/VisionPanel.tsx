"use client";
import { useEffect, useRef, useState } from "react";
import { nexus } from "@/nexus/core/api";
import type { VisionEngine, VisionStatus } from "@/nexus/vision/VisionEngine";
import { Badge, Btn, ErrorLine, Panel } from "@/nexus/ui/kit";

export default function VisionPanel({ onClose, engine, status, onAnswer }: {
  onClose: () => void; engine: VisionEngine | null; status: VisionStatus; onAnswer: (q: string, a: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [opts, setOpts] = useState(engine?.opts ?? { pose: true, hands: true, face: true, mirror: false });
  const [asking, setAsking] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (!engine || !box.current) return;
    const v = engine.video;
    v.className = "w-full h-full object-cover rounded-xl";
    v.style.transform = engine.facingMode === "user" ? "scaleX(-1)" : "";
    box.current.appendChild(v);
    return () => { v.remove(); };
  }, [engine, status.camera]);

  const setOpt = (k: keyof typeof opts, v: boolean) => {
    const next = { ...opts, [k]: v };
    setOpts(next);
    if (engine) engine.opts = next;
  };

  const ask = async (question: string) => {
    if (!engine) return;
    if (!status.camera && !(await engine.startCamera())) return;
    await new Promise((r) => setTimeout(r, 300));
    const frame = engine.captureFrame();
    if (!frame) { setError("Could not capture a frame from the camera."); return; }
    setAsking(question); setAnswer(null); setError(null);
    try {
      const r = await nexus.visionAsk(question, frame);
      if (r.ok) { setAnswer(r.answer); onAnswer(question, r.answer); }
      else setError(`${r.error}${r.setup ? " — " + r.setup.join("; ") : ""}`);
    } catch (e: any) { setError(e.message); } finally { setAsking(null); }
  };

  return (
    <Panel title="Vision" onClose={onClose}
      subtitle="Camera analysis and body-motion mirroring. Tracking runs on this device; a frame is only sent when you ask a question."
      actions={<Badge tone={status.camera ? "err" : "mute"}>{status.camera ? "● camera live" : "camera off"}</Badge>}>
      <ErrorLine error={error || status.error} />
      <div ref={box} className="relative aspect-video bg-black/40 rounded-xl border border-cyan-300/10 overflow-hidden flex items-center justify-center">
        {!status.camera && <span className="text-xs text-slate-500">Camera is off</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {!status.camera
          ? <Btn variant="primary" onClick={() => engine?.startCamera()}>Turn camera on</Btn>
          : <Btn variant="danger" onClick={() => engine?.stop()}>Turn camera off</Btn>}
        {!status.tracking
          ? <Btn onClick={() => engine?.startTracking()} disabled={status.loading}>{status.loading ? "Loading models…" : "Start motion mirroring"}</Btn>
          : <Btn onClick={() => engine?.stopTracking()}>Stop mirroring</Btn>}
        {status.camera && (
          <Btn small onClick={async () => {
            if (!engine) return;
            engine.facingMode = engine.facingMode === "user" ? "environment" : "user";
            const tracking = status.tracking;
            engine.stop();
            await engine.startCamera();
            if (tracking) await engine.startTracking();
          }}>Flip camera</Btn>
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-300">
        {(["pose", "hands", "face"] as const).map((k) => (
          <label key={k} className="flex items-center gap-1.5"><input type="checkbox" className="accent-cyan-400" checked={opts[k]} onChange={(e) => setOpt(k, e.target.checked)} />{k}</label>
        ))}
        <label className="flex items-center gap-1.5" title="Off: your left hand moves the avatar's left hand. On: behaves like a mirror.">
          <input type="checkbox" className="accent-cyan-400" checked={opts.mirror} onChange={(e) => setOpt("mirror", e.target.checked)} />mirror mode
        </label>
        {status.tracking && <span className="nx-mono text-slate-500">tracking {status.fps} fps</span>}
      </div>

      <div className="space-y-2">
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Ask about what the camera sees</h3>
        <div className="flex flex-wrap gap-2">
          <Btn variant="primary" disabled={!!asking} onClick={() => ask("What am I looking at? Describe the scene and the main objects.")}>What am I looking at?</Btn>
          <Btn disabled={!!asking} onClick={() => ask("Read all the text visible in this image exactly (OCR).")}>Read this</Btn>
          <Btn disabled={!!asking} onClick={() => ask("What is the main object or product in view? Identify it as precisely as possible.")}>What's that object?</Btn>
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (custom.trim()) ask(custom); }}>
          <input className="nx-input" placeholder="Ask anything about the image…" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Btn type="submit" disabled={!!asking || !custom.trim()}>Ask</Btn>
        </form>
        {asking && <p className="text-xs text-cyan-300 animate-pulse">Analyzing frame…</p>}
        {answer && <p className="nx-card text-sm text-slate-200 whitespace-pre-wrap">{answer}</p>}
      </div>
    </Panel>
  );
}
