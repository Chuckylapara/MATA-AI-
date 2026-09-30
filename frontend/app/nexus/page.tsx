"use client";
// NEXUS — command center. Avatar + voice + vision + streaming orchestration + control panels.
import { useCallback, useEffect, useRef, useState } from "react";
import type { NexusAvatar } from "@/nexus/avatar/NexusAvatar";
import { STATE_PARAMS } from "@/nexus/avatar/states";
import { converse, nexus } from "@/nexus/core/api";
import { bus } from "@/nexus/core/bus";
import type { AvatarState, ChatTurn, PendingAction } from "@/nexus/core/types";
import { AVATAR_STATES } from "@/nexus/core/types";
import { VoiceEngine, voiceSupport } from "@/nexus/voice/VoiceEngine";
import type { VisionEngine, VisionStatus } from "@/nexus/vision/VisionEngine";
import { api, apiBase, getToken, setApiBase } from "@/lib/api";
import AutomationCenter from "@/nexus/ui/AutomationCenter";
import CapabilityPanel from "@/nexus/ui/CapabilityPanel";
import ConfirmDialog from "@/nexus/ui/ConfirmDialog";
import HomePanel from "@/nexus/ui/HomePanel";
import MemoryCenter from "@/nexus/ui/MemoryCenter";
import SecurityCenter from "@/nexus/ui/SecurityCenter";
import SettingsPanel, { type ClientSettings } from "@/nexus/ui/SettingsPanel";
import SystemDashboard, { type LiveMetrics } from "@/nexus/ui/SystemDashboard";
import VisionPanel from "@/nexus/ui/VisionPanel";
import { Badge, Btn, Empty, Panel, clock } from "@/nexus/ui/kit";

const SECTIONS = [
  { key: "home", label: "Home", icon: "◈" }, { key: "chat", label: "Chat", icon: "◌" },
  { key: "vision", label: "Vision", icon: "◉" }, { key: "memory", label: "Memory", icon: "◍" },
  { key: "tasks", label: "Tasks", icon: "◷" }, { key: "automations", label: "Automations", icon: "↻" },
  { key: "web", label: "Web", icon: "◎" }, { key: "social", label: "Social", icon: "◐" },
  { key: "creator", label: "Creator", icon: "✦" }, { key: "projects", label: "Projects", icon: "▣" },
  { key: "files", label: "Files", icon: "▤" }, { key: "settings", label: "Settings", icon: "⚙" },
  { key: "security", label: "Security", icon: "⛨" }, { key: "system", label: "System", icon: "⌁" },
] as const;

const DEFAULT_SETTINGS: ClientSettings = { quality: "high", speak: true, lang: "es-ES", voiceURI: null, rate: 1.02, micDevice: null };
const RESTING: AvatarState[] = ["SUCCESS", "WARNING", "ERROR"];
const uid = () => Math.random().toString(36).slice(2);

const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 639px), (pointer: coarse) and (max-width: 1024px)").matches;

function loadSettings(): ClientSettings {
  // Phones default to medium quality (smooth frame rate with the camera tracking on).
  const base = isPhone() ? { ...DEFAULT_SETTINGS, quality: "medium" as const } : DEFAULT_SETTINGS;
  try { return { ...base, ...JSON.parse(localStorage.getItem("nexus_settings") || "{}") }; }
  catch { return base; }
}

export default function NexusPage() {
  const host = useRef<HTMLDivElement>(null);
  const avatar = useRef<NexusAvatar | null>(null);
  const voice = useRef<VoiceEngine | null>(null);
  const vision = useRef<VisionEngine | null>(null);
  const stream = useRef<{ abort: () => void } | null>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const convId = useRef<string | null>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t0 = useRef(0);

  const [mode, setMode] = useState<"full" | "tv">("full");
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<ClientSettings>(DEFAULT_SETTINGS);
  const [state, setStateRaw] = useState<AvatarState>("IDLE");
  const [panel, setPanel] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [caption, setCaption] = useState("");
  const [interim, setInterim] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [vstatus, setVstatus] = useState<VisionStatus>({ camera: false, tracking: false, loading: false, error: null, fps: 0 });
  const [pending, setPending] = useState<PendingAction[]>([]);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [feed, setFeed] = useState<any[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [name, setName] = useState<string | null>(null);
  const [live, setLive] = useState<LiveMetrics>({ fps: 0, visionFps: 0, latencyMs: null, lastChars: 0, mic: false,
    camera: false, tracking: false, activeTools: [], state: "IDLE", errors: [] });

  // ----------------------------------------------------------------- avatar state
  const setState = useCallback((s: AvatarState) => {
    setStateRaw(s);
    avatar.current?.setState(s);
    channel.current?.postMessage({ type: "state", state: s });
    bus.emit("AVATAR_STATE_CHANGED", { state: s });
    if (restTimer.current) clearTimeout(restTimer.current);
    if (RESTING.includes(s)) {
      restTimer.current = setTimeout(() => {
        const next = voice.current?.micOn ? "LISTENING" : "IDLE";
        setStateRaw(next); avatar.current?.setState(next); channel.current?.postMessage({ type: "state", state: next });
      }, s === "ERROR" ? 4000 : 2600);
    }
  }, []);

  const pushError = (msg: string) => setLive((l) => ({ ...l, errors: [...l.errors.slice(-20), `${new Date().toLocaleTimeString()} ${msg}`] }));
  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3500); };

  // ----------------------------------------------------------------- boot
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const m = params.get("display") === "tv" ? "tv" : "full";
    setMode(m);
    const s = loadSettings();
    setSettings(s);
    setAuthed(!!getToken());
    setMicSupported(voiceSupport().mic);
    channel.current = "BroadcastChannel" in window ? new BroadcastChannel("nexus-display") : null;

    let dead = false;
    import("@/nexus/avatar/NexusAvatar").then(({ NexusAvatar }) => {
      if (dead || !host.current) return;
      avatar.current = new NexusAvatar(host.current, s.quality);
      avatar.current.setFraming(m);
      const forced = params.get("state") as AvatarState | null;
      if (forced && AVATAR_STATES.includes(forced)) setState(forced);
    });

    // TV / display mode mirrors the main window over BroadcastChannel (same machine, e.g. a second screen).
    if (m === "tv" && channel.current) {
      channel.current.onmessage = (e) => {
        const d = e.data;
        if (d.type === "state") { setStateRaw(d.state); avatar.current?.setState(d.state); }
        if (d.type === "caption") setCaption(d.text);
        if (d.type === "audio") avatar.current?.setAudioLevel(d.level);
        if (d.type === "rig") avatar.current?.setRig(d.rig);
      };
    }

    const v = new VoiceEngine({
      onInterim: (t) => { setInterim(t); },
      onFinal: (t) => { setInterim(""); sendRef.current(t, "voice"); },
      onMicLevel: (lvl) => avatar.current?.setMicLevel(lvl),
      onSpeechLevel: (lvl) => { avatar.current?.setAudioLevel(lvl); channel.current?.postMessage({ type: "audio", level: lvl }); },
      onSpeakingChange: (on) => {
        setSpeaking(on);
        if (on) setState("SPEAKING");
        else if (avatar.current && ["SPEAKING"].includes(avatar.current.getState())) setState(v.micOn ? "LISTENING" : "IDLE");
      },
      onError: (msg) => { flash(msg); pushError(msg); },
      onListeningChange: (on) => { setMicOn(on); setLive((l) => ({ ...l, mic: on })); },
    });
    v.lang = s.lang; v.voiceURI = s.voiceURI; v.rate = s.rate; v.deviceId = s.micDevice;
    voice.current = v;

    const offInt = bus.on("USER_INTERRUPTED", (d) => { nexus.clientEvent("USER_INTERRUPTED", d); });
    const fpsTimer = setInterval(() => setLive((l) => ({ ...l, fps: avatar.current?.fps ?? 0 })), 1000);

    return () => {
      dead = true;
      offInt(); clearInterval(fpsTimer);
      stream.current?.abort();
      v.dispose();
      vision.current?.dispose();
      avatar.current?.dispose();
      channel.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load server-side state once authenticated
  const refreshFeed = useCallback(() => { nexus.feed().then(setFeed).catch(() => null); }, []);
  useEffect(() => {
    if (!authed || mode === "tv") return;
    nexus.status().then(setStatus).catch((e) => pushError(String(e.message || e)));
    nexus.profile().then((p) => setName(p.display_name)).catch(() => null);
    nexus.pending().then((p: any[]) => setPending(p.map((x) => ({ action_id: x.id, tool: x.tool, preview: x.preview, reason: x.reason })))).catch(() => null);
    refreshFeed();
    const i = setInterval(refreshFeed, 10000);
    return () => clearInterval(i);
  }, [authed, mode, refreshFeed]);

  // apply settings
  useEffect(() => {
    try { localStorage.setItem("nexus_settings", JSON.stringify(settings)); } catch { /* private mode */ }
    const v = voice.current;
    if (v) { v.lang = settings.lang; v.voiceURI = settings.voiceURI; v.rate = settings.rate; v.deviceId = settings.micDevice; }
  }, [settings]);

  // quality change → rebuild avatar
  const lastQuality = useRef(settings.quality);
  useEffect(() => {
    if (lastQuality.current === settings.quality || !host.current) return;
    lastQuality.current = settings.quality;
    import("@/nexus/avatar/NexusAvatar").then(({ NexusAvatar }) => {
      avatar.current?.dispose();
      avatar.current = new NexusAvatar(host.current!, settings.quality);
      avatar.current.setFraming(mode);
      avatar.current.setState(state);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.quality]);

  // ----------------------------------------------------------------- conversation
  const send = useCallback((raw: string, channelKind: "text" | "voice" = "text") => {
    const text = raw.trim();
    if (!text) return;
    const v = voice.current;
    // "Espera." → stop talking, acknowledge, keep listening (handled locally, instantly).
    if (VoiceEngine.isStopCommand(text)) {
      stream.current?.abort();
      v?.interrupt("user");
      setBusy(false);
      setTurns((t) => [...t, { id: uid(), role: "user", text, ts: Date.now() }]);
      const ack = settings.lang.startsWith("es") ? "¿Sí?" : "Yes?";
      setCaption(ack);
      if (settings.speak) v?.say(ack);
      setState(v?.micOn ? "LISTENING" : "IDLE");
      return;
    }
    if (!authed) { flash("Sign in to talk with NEXUS."); return; }
    stream.current?.abort();
    v?.interrupt("user");
    setTurns((t) => [...t, { id: uid(), role: "user", text, ts: Date.now() }]);
    setCaption(""); setBusy(true); setState("THINKING");
    t0.current = performance.now();
    let reply = "";
    let first = true;
    const assistantId = uid();
    const tools = new Set<string>();

    const handle = converse(text, convId.current, (ev, d) => {
      switch (ev) {
        case "conversation": convId.current = d.conversation_id; break;
        case "state": if (!(d.state === "SPEAKING" && !settings.speak)) setState(d.state); break;
        case "token":
          if (first) { first = false; setLive((l) => ({ ...l, latencyMs: Math.round(performance.now() - t0.current) })); }
          reply += d.text;
          setCaption(reply);
          channel.current?.postMessage({ type: "caption", text: reply });
          if (settings.speak) v?.pushText(d.text);
          break;
        case "tool":
          if (d.status === "started") { tools.add(d.tool); bus.emit("TOOL_STARTED", d); }
          else { tools.delete(d.tool); bus.emit("TOOL_COMPLETED", d); }
          setLive((l) => ({ ...l, activeTools: [...tools] }));
          break;
        case "memory":
          if (d.action === "created") { flash(`Remembered: ${d.memory.content}`); bus.emit("MEMORY_CREATED", d); }
          if (d.action === "retrieved") bus.emit("MEMORY_RETRIEVED", d);
          break;
        case "confirmation_required":
          setPending((p) => [...p, d]); bus.emit("CONFIRMATION_REQUIRED", d); break;
        case "error":
          pushError(d.message);
          setTurns((t) => [...t, { id: uid(), role: "system", text: d.message, ts: Date.now(), meta: { error: d.code } }]);
          setState("ERROR");
          break;
        case "done":
          setTurns((t) => [...t, { id: assistantId, role: "assistant", text: d.reply || reply, ts: Date.now(),
            meta: { provider: d.provider, tools: d.tools } }]);
          setLive((l) => ({ ...l, lastChars: (d.reply || reply).length, activeTools: [] }));
          if (settings.speak) v?.flush();
          break;
      }
    }, channelKind);
    stream.current = handle;
    handle.done.finally(() => {
      if (stream.current === handle) setBusy(false);
      refreshFeed();
    });
  }, [authed, settings.lang, settings.speak, setState, refreshFeed]);

  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; }, [send]);

  // ----------------------------------------------------------------- mic / camera
  const toggleMic = async () => {
    const v = voice.current!;
    v.unlock();   // must run inside the tap so replies can be heard on phones
    if (v.micOn) { v.stopListening(); setState("IDLE"); return; }
    if (await v.startListening()) setState("LISTENING");
  };

  const ensureVision = async () => {
    if (!vision.current) {
      const { VisionEngine } = await import("@/nexus/vision/VisionEngine");
      vision.current = new VisionEngine(
        (rig) => { avatar.current?.setRig(rig); channel.current?.postMessage({ type: "rig", rig }); },
        (s) => {
          setVstatus(s);
          setLive((l) => ({ ...l, camera: s.camera, tracking: s.tracking, visionFps: s.fps }));
          if (s.error) pushError(s.error);
        },
      );
      if (isPhone()) vision.current.opts = { ...vision.current.opts, hands: false };  // keep phones smooth
      bus.on("CAMERA_ENABLED", () => nexus.clientEvent("CAMERA_ENABLED"));
      bus.on("CAMERA_DISABLED", () => nexus.clientEvent("CAMERA_DISABLED"));
    }
    return vision.current;
  };

  const toggleCamera = async () => {
    const ve = await ensureVision();
    if (ve.status.camera) ve.stop();
    else {
      // On a phone keep the avatar in view (small camera preview in the corner); on desktop open the panel.
      if (isPhone()) setPanel(null); else setPanel("vision");
      await ve.startTracking();
    }
  };

  // ----------------------------------------------------------------- confirmations
  const resolvePending = async (a: PendingAction, ok: boolean) => {
    setConfirmBusy(true);
    try {
      if (ok) {
        const r = await nexus.confirm(a.action_id);
        const msg = r.result.ok ? `Done: ${a.tool}` : `${a.tool} failed: ${r.result.error}`;
        setTurns((t) => [...t, { id: uid(), role: "system", text: msg, ts: Date.now() }]);
        setState(r.result.ok ? "SUCCESS" : "ERROR");
      } else {
        await nexus.reject(a.action_id);
        setTurns((t) => [...t, { id: uid(), role: "system", text: `Cancelled: ${a.tool}`, ts: Date.now() }]);
        setState("CALM");
      }
    } catch (e: any) {
      pushError(e.message); flash(e.message);
    } finally {
      setPending((p) => p.filter((x) => x.action_id !== a.action_id));
      setConfirmBusy(false);
      refreshFeed();
    }
  };

  // keyboard: Esc interrupts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { voice.current?.interrupt("user"); stream.current?.abort(); setBusy(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----------------------------------------------------------------- render
  const tv = mode === "tv";
  const devMock = status?.dev_mock_active;
  const openPanel = (k: string) => {
    if (k === "vision") ensureVision();
    setPanel((p) => (p === k ? null : k));
  };
  const close = () => setPanel(null);

  return (
    <div className="nx-root fixed inset-0 z-[60] overflow-hidden text-slate-200">
      <div ref={host} className="absolute inset-0" aria-hidden="true" />
      <div className="nx-vignette pointer-events-none absolute inset-0" />

      {/* ---------------- top bar */}
      <header className="absolute top-0 inset-x-0 flex items-center gap-3 px-4 sm:px-6 pt-4 z-20">
        {!tv && (
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`} className="flex items-center gap-2 group" aria-label="MATA AI home">
            <span className="nx-logo" aria-hidden="true" />
            <span className="nx-mono text-[13px] tracking-[0.35em] text-cyan-100">NEXUS</span>
            <span className="hidden sm:inline nx-mono text-[10px] tracking-[0.2em] text-slate-500">· MATA AI</span>
          </a>
        )}
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {devMock && !tv && <button onClick={() => openPanel("system")}><Badge tone="warn">dev mock<span className="hidden sm:inline"> · no AI configured</span></Badge></button>}
          {micOn && <span className="nx-live" title="Microphone is live"><i />MIC</span>}
          {vstatus.camera && <span className="nx-live" title="Camera is live"><i />CAM</span>}
          <span className="nx-mono text-[10px] sm:text-xs tracking-[0.22em] text-cyan-300 whitespace-nowrap" aria-live="polite">STATUS: {state}</span>
        </div>
      </header>

      {/* ---------------- sidebar */}
      {!tv && (
        <nav aria-label="NEXUS sections" className="nx-sidebar absolute z-20 left-0 bottom-[calc(env(safe-area-inset-bottom)+132px)] sm:bottom-auto sm:top-20 flex sm:flex-col gap-1 px-2 sm:px-3 overflow-x-auto sm:overflow-visible max-w-full">
          {SECTIONS.map((s) => (
            <button key={s.key} onClick={() => openPanel(s.key)} aria-pressed={panel === s.key}
              className={`nx-nav ${panel === s.key ? "nx-nav-on" : ""}`}>
              <span aria-hidden="true" className="w-4 text-center">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      )}

      {/* ---------------- centre prompt + captions */}
      <div className={`absolute inset-x-0 z-10 flex flex-col items-center px-4 pointer-events-none ${tv ? "bottom-16" : "bottom-[calc(env(safe-area-inset-bottom)+190px)] sm:bottom-32"}`}>
        {!caption && !interim && !busy && (
          <p className="nx-mono text-[11px] tracking-[0.3em] uppercase text-cyan-200/70">
            {name ? `Hola ${name} · ` : ""}{micOn ? "Te escucho · habla cuando quieras" : "¿En qué te ayudo? · toca el micrófono para hablar"}
          </p>
        )}
        {interim && <p className="text-base sm:text-lg text-cyan-100/80 italic text-center max-w-2xl">“{interim}”</p>}
        {caption && (
          <p className={`nx-caption text-center max-w-3xl ${tv ? "text-2xl sm:text-3xl" : "text-sm sm:text-base"}`}>
            {caption.length > 420 ? "…" + caption.slice(-420) : caption}
          </p>
        )}
        {busy && !caption && <p className="nx-mono text-[11px] tracking-[0.3em] text-orange-200/80 animate-pulse uppercase">{STATE_PARAMS[state]?.label ?? state}…</p>}
      </div>

      {/* ---------------- input bar */}
      {!tv && (
        <form onSubmit={(e) => { e.preventDefault(); voice.current?.unlock(); send(input); setInput(""); }}
          className="absolute z-20 inset-x-0 bottom-0 px-3 sm:px-6 pb-[calc(env(safe-area-inset-bottom)+14px)] pt-3">
          <div className="nx-inputbar mx-auto max-w-3xl flex items-center gap-2 p-2">
            <button type="button" onClick={toggleMic} aria-pressed={micOn}
              aria-label={micOn ? "Turn microphone off" : "Turn microphone on"}
              className={`nx-round ${micOn ? "nx-round-live" : ""}`} disabled={!micSupported}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
            <button type="button" onClick={toggleCamera} aria-pressed={vstatus.camera}
              aria-label={vstatus.camera ? "Turn camera off" : "Turn camera on"} className={`nx-round ${vstatus.camera ? "nx-round-live" : ""}`}>
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="12.5" r="3.5" /></svg>
            </button>
            <input value={input} onChange={(e) => setInput(e.target.value)} aria-label="Message NEXUS"
              placeholder={authed === false ? "Inicia sesión para hablar con NEXUS" : "Escribe o toca el micrófono…"}
              className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-slate-500 px-2" />
            {(speaking || busy) && (
              <button type="button" onClick={() => { voice.current?.interrupt("user"); stream.current?.abort(); setBusy(false); setState("IDLE"); }}
                className="nx-mono text-[10px] tracking-widest text-orange-200 px-2" aria-label="Stop">STOP</button>
            )}
            <button type="button" onClick={() => openPanel("tools")} className="nx-mono text-[10px] tracking-widest text-cyan-200/80 px-2 hidden sm:block">TOOLS</button>
            <button type="submit" className="nx-send" aria-label="Send" disabled={!input.trim()}>
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor"><path d="M3 11.5 21 3l-7.5 18-2.2-7.3z" /></svg>
            </button>
          </div>
        </form>
      )}

      {/* ---------------- action feed (desktop, when no panel is open) */}
      {!tv && !panel && authed && (
        <aside aria-label="Action feed" className="hidden lg:block absolute right-6 top-20 z-10 w-72">
          <p className="nx-mono text-[10px] tracking-[0.25em] text-slate-500 mb-2">ACTION FEED</p>
          <ul className="space-y-1">
            {feed.slice(0, 7).map((f) => (
              <li key={f.id} className="nx-mono text-[11px] text-slate-400 truncate"><span className="text-slate-600">{clock(f.created_at)}</span> {f.message}</li>
            ))}
            {!feed.length && <li className="nx-mono text-[11px] text-slate-600">No activity yet.</li>}
          </ul>
        </aside>
      )}

      {/* ---------------- panels */}
      {!tv && panel && (
        <div className="nx-drawer absolute z-30 right-0 sm:right-4 top-auto sm:top-16 bottom-0 sm:bottom-28 w-full sm:w-[460px] max-h-[72vh] sm:max-h-none flex">
          {panel === "home" && <HomePanel onClose={close} onOpen={openPanel} name={name} />}
          {panel === "memory" && <MemoryCenter onClose={close} />}
          {panel === "projects" && <MemoryCenter onClose={close} fixedType="project" title="Projects" />}
          {(panel === "tasks" || panel === "automations") && <AutomationCenter onClose={close} />}
          {panel === "security" && <SecurityCenter onClose={close} />}
          {panel === "system" && <SystemDashboard onClose={close} live={{ ...live, state }} />}
          {panel === "settings" && <SettingsPanel onClose={close} settings={settings} onChange={setSettings} voice={voice.current} />}
          {panel === "vision" && (
            <VisionPanel onClose={close} engine={vision.current} status={vstatus}
              onAnswer={(q, a) => { setTurns((t) => [...t, { id: uid(), role: "user", text: `📷 ${q}`, ts: Date.now() }, { id: uid(), role: "assistant", text: a, ts: Date.now() }]); setCaption(a); if (settings.speak) voice.current?.say(a); }} />
          )}
          {["web", "social", "creator", "files", "communication"].includes(panel) && (
            <CapabilityPanel id={panel} onClose={close} onPrompt={(p) => { setInput(p); close(); }} />
          )}
          {panel === "chat" && (
            <Panel title="Conversation" onClose={close} actions={<Btn small onClick={() => { setTurns([]); convId.current = null; setCaption(""); }}>New</Btn>}>
              {!turns.length && <Empty>Say hello — type below or turn on the microphone.</Empty>}
              <ul className="space-y-3">
                {turns.map((t) => (
                  <li key={t.id} className={t.role === "user" ? "text-right" : ""}>
                    <div className={`inline-block text-left rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap max-w-[92%] ${
                      t.role === "user" ? "bg-cyan-400/10 border border-cyan-300/20" : t.role === "system" ? "bg-amber-400/5 border border-amber-300/20 text-amber-100" : "bg-white/[0.03] border border-white/10"}`}>
                      {t.text}
                    </div>
                    {t.meta?.tools && t.meta.tools.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">{t.meta.tools.map((x, i) => <Badge key={i} tone={x.ok ? "ok" : x.error_code === "confirmation_required" ? "warn" : "err"}>{x.tool}</Badge>)}</div>
                    )}
                    {t.meta?.provider && <div className="nx-mono text-[9px] text-slate-600 mt-0.5">{t.meta.provider}</div>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {panel === "tools" && <ToolsPanel onClose={close} />}
        </div>
      )}

      {/* ---------------- live camera preview (when the Vision panel is closed) */}
      {!tv && vstatus.camera && panel !== "vision" && (
        <CameraPip engine={vision.current} tracking={vstatus.tracking} loading={vstatus.loading} onOpen={() => openPanel("vision")} />
      )}

      {/* ---------------- toasts, auth gate, confirmation */}
      {toast && <div role="status" className="absolute z-40 top-16 left-1/2 -translate-x-1/2 nx-toast">{toast}</div>}
      {authed === false && !tv && (
        <div className="absolute z-40 inset-x-0 top-20 flex justify-center px-4">
          <SignIn onDone={() => { setAuthed(true); location.reload(); }} />
        </div>
      )}
      {pending[0] && <ConfirmDialog action={pending[0]} busy={confirmBusy} onConfirm={() => resolvePending(pending[0], true)} onReject={() => resolvePending(pending[0], false)} />}
    </div>
  );
}

function ToolsPanel({ onClose }: { onClose: () => void }) {
  const [tools, setTools] = useState<any[]>([]);
  useEffect(() => { nexus.tools().then(setTools).catch(() => null); }, []);
  return (
    <Panel title="Tools" subtitle="Every tool NEXUS can use, its risk level and whether it is available right now." onClose={onClose}>
      <ul className="space-y-2">
        {tools.map((t) => (
          <li key={t.name} className="nx-card">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="nx-mono text-xs text-slate-100">{t.name}</span>
              <Badge tone={t.risk === "high" ? "err" : t.risk === "medium" ? "warn" : "ok"}>{t.risk} risk</Badge>
              {t.confirmation_required && <Badge tone="gold">confirm</Badge>}
              <Badge tone={t.available ? "ok" : "mute"}>{t.available ? "available" : "integration not configured"}</Badge>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{t.description}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CameraPip({ engine, tracking, loading, onOpen }: { engine: VisionEngine | null; tracking: boolean; loading: boolean; onOpen: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!engine || !box.current) return;
    const v = engine.video;
    v.className = "w-full h-full object-cover";
    v.style.transform = engine.facingMode === "user" ? "scaleX(-1)" : "";
    box.current.appendChild(v);
    return () => { v.remove(); };
  }, [engine]);
  return (
    <button onClick={onOpen} aria-label="Open vision panel"
      className="absolute z-20 left-3 sm:left-auto sm:right-6 top-16 sm:top-auto sm:bottom-28 w-24 h-32 sm:w-40 sm:h-28 rounded-xl overflow-hidden border border-rose-300/50 shadow-lg shadow-black/50 bg-black/60">
      <div ref={box} className="absolute inset-0" />
      <span className="absolute bottom-1 left-1 right-1 nx-mono text-[9px] tracking-widest text-rose-100 bg-black/50 rounded px-1 py-0.5">
        {loading ? "CARGANDO…" : tracking ? "● SIGUIENDO" : "● CÁMARA"}
      </span>
    </button>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [showServer, setShowServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setServer(apiBase()); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      if (showServer) setApiBase(server || null);
      if (mode === "login") await api.login({ email, password });
      else await api.register({ email, password });
      onDone();
    } catch (err: any) {
      const msg = String(err?.message || err);
      setError(/fetch|network|load failed/i.test(msg)
        ? "No se pudo conectar con el servidor. Revisa la dirección del servidor (abajo) o espera un minuto si estaba dormido."
        : msg);
      setShowServer(true);
    } finally { setLoading(false); }
  };

  return (
    <form onSubmit={submit} className="nx-panel px-5 py-5 w-full max-w-sm space-y-3">
      <p className="nx-mono text-[10px] tracking-[0.3em] text-cyan-300">{mode === "login" ? "INICIA SESIÓN" : "CREA TU CUENTA"}</p>
      <p className="text-xs text-slate-400">Tu cuenta de MATA mantiene privada tu memoria, tus permisos y tus tareas.</p>
      <input id="nx-email" className="nx-input" type="email" autoComplete="email" placeholder="correo@ejemplo.com"
        value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Correo" />
      <input id="nx-password" className="nx-input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"}
        placeholder="Contraseña" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required aria-label="Contraseña" />
      {showServer && (
        <label className="block">
          <span className="nx-mono block text-[10px] tracking-[0.2em] uppercase text-slate-400 mb-1">Servidor</span>
          <input id="nx-server" className="nx-input" type="url" placeholder="https://tu-servidor" value={server} onChange={(e) => setServer(e.target.value)} />
        </label>
      )}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      <button type="submit" disabled={loading} className="nx-btn nx-btn-primary text-sm px-4 py-2 w-full">
        {loading ? "Conectando…" : mode === "login" ? "Entrar" : "Crear cuenta"}
      </button>
      <div className="flex justify-between text-[11px] text-slate-400">
        <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")} className="hover:text-cyan-200">
          {mode === "login" ? "¿No tienes cuenta? Crea una" : "Ya tengo cuenta"}
        </button>
        <button type="button" onClick={() => setShowServer(!showServer)} className="hover:text-cyan-200">Servidor</button>
      </div>
    </form>
  );
}
