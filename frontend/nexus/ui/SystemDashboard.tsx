"use client";
import { useCallback, useEffect, useState } from "react";
import { nexus } from "@/nexus/core/api";
import { bus } from "@/nexus/core/bus";
import { Badge, Btn, ErrorLine, Panel, statusTone } from "@/nexus/ui/kit";

export interface LiveMetrics {
  fps: number; visionFps: number; latencyMs: number | null; lastChars: number; mic: boolean; camera: boolean;
  tracking: boolean; activeTools: string[]; state: string; errors: string[];
}

export default function SystemDashboard({ onClose, live }: { onClose: () => void; live: LiveMetrics }) {
  const [health, setHealth] = useState<any>(null);
  const [hw, setHw] = useState<any>(null);
  const [status, setStatus] = useState<any>(null);
  const [agents, setAgents] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, w, s, a, e] = await Promise.all([nexus.health(), nexus.hardware(), nexus.status(), nexus.agents(), nexus.serverEvents()]);
      setHealth(h); setHw(w); setStatus(s); setAgents(a); setEvents(e.slice(-25).reverse()); setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); const i = setInterval(load, 10000); return () => clearInterval(i); }, [load]);

  const stat = (label: string, value: any, tone?: string) => (
    <div className="nx-card py-2">
      <div className="nx-mono text-[9px] tracking-[0.2em] uppercase text-slate-500">{label}</div>
      <div className={`nx-mono text-sm ${tone ?? "text-slate-100"}`}>{value ?? "—"}</div>
    </div>
  );

  return (
    <Panel title="System · Developer dashboard" onClose={onClose} subtitle="Live diagnostics, hardware, model routing and event traces."
      actions={<Btn small onClick={load}>Refresh</Btn>}>
      <ErrorLine error={error} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat("Render FPS", live.fps)}
        {stat("Vision FPS", live.tracking ? live.visionFps : "off")}
        {stat("First token", live.latencyMs != null ? `${live.latencyMs} ms` : "—")}
        {stat("Last reply", `${live.lastChars} chars`)}
        {stat("Avatar state", live.state, "text-cyan-300")}
        {stat("Microphone", live.mic ? "LIVE" : "off", live.mic ? "text-rose-300" : undefined)}
        {stat("Camera", live.camera ? "LIVE" : "off", live.camera ? "text-rose-300" : undefined)}
        {stat("Active tools", live.activeTools.join(", ") || "none")}
        {hw?.cpu && stat("CPU", `${hw.cpu.usage_pct ?? "?"}% · ${hw.cpu.logical_cores} cores`)}
        {hw?.ram && stat("RAM", `${Math.round(hw.ram.available_mb / 1024)} / ${Math.round(hw.ram.total_mb / 1024)} GB free`)}
        {hw && stat("GPU / VRAM", hw.gpus?.length ? hw.gpus.map((g: any) => `${g.name}${g.vram_total_mb ? ` ${Math.round(g.vram_total_mb / 1024)}GB` : ""}`).join(", ") : "none detected")}
        {hw?.storage && stat("Storage", `${hw.storage.free_gb} GB free`)}
      </div>

      {health && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Self-diagnostics</h3>
            <Badge tone={statusTone(health.overall)}>{health.overall}</Badge>
          </div>
          <ul className="space-y-1">
            {health.checks.map((c: any) => (
              <li key={c.name} className="flex flex-wrap items-start gap-2 text-xs">
                <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                <span className="nx-mono text-slate-200 min-w-[92px]">{c.name}</span>
                <span className="text-slate-400">{c.detail}{c.fix && <span className="block text-amber-200/80">→ {c.fix}</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status && (
        <div>
          <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Model routing</h3>
          <ul className="space-y-1">
            {Object.entries(status.models).map(([role, m]: any) => (
              <li key={role} className="nx-mono text-xs text-slate-300">
                <span className="text-slate-500 inline-block w-24">{role}</span>
                {m.provider ? `${m.provider} · ${m.model}` : <span className="text-amber-300">not configured</span>}
                {m.local && m.provider !== "mock" && <Badge tone="ok">local</Badge>}
                {m.provider === "mock" && <Badge tone="warn">dev mock</Badge>}
              </li>
            ))}
          </ul>
          {hw?.recommendation && (
            <p className="text-[11px] text-slate-400 mt-2">Hardware tier <b className="text-slate-200">{hw.recommendation.tier}</b> — suggested local models:{" "}
              {Object.entries(hw.recommendation.ollama_models).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
          )}
        </div>
      )}

      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Agents</h3>
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => <Badge key={a.name} tone={statusTone(a.status)}>{a.name}{a.status !== "ready" ? ` · ${a.status}${a.phase ? ` p${a.phase}` : ""}` : ""}</Badge>)}
        </div>
      </div>

      <div>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-2">Event trace (server)</h3>
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {events.map((e, i) => (
            <li key={i} className="nx-mono text-[10px] text-slate-400">{new Date(e.ts * 1000).toLocaleTimeString()} <span className="text-cyan-200">{e.name}</span> {JSON.stringify(e.data).slice(0, 90)}</li>
          ))}
        </ul>
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400 mt-3 mb-2">Event trace (client)</h3>
        <ul className="space-y-0.5 max-h-40 overflow-y-auto">
          {bus.recent(20).reverse().map((e, i) => (
            <li key={i} className="nx-mono text-[10px] text-slate-400">{new Date(e.ts).toLocaleTimeString()} <span className="text-orange-200">{e.name}</span> {JSON.stringify(e.data).slice(0, 80)}</li>
          ))}
        </ul>
      </div>

      {live.errors.length > 0 && (
        <div>
          <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-rose-300 mb-2">Recent errors</h3>
          <ul className="space-y-1">{live.errors.slice(-8).map((e, i) => <li key={i} className="text-xs text-rose-200/80">{e}</li>)}</ul>
        </div>
      )}
    </Panel>
  );
}
