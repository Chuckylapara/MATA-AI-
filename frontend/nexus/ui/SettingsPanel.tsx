"use client";
import { useEffect, useState } from "react";
import { aiKeyProvider, getAiKey, nexus, setAiKey } from "@/nexus/core/api";
import type { VoiceEngine } from "@/nexus/voice/VoiceEngine";
import { voiceSupport } from "@/nexus/voice/VoiceEngine";
import { Badge, Btn, ErrorLine, Field, Panel } from "@/nexus/ui/kit";

export interface ClientSettings {
  quality: "low" | "medium" | "high";
  speak: boolean;
  lang: string;
  voiceURI: string | null;
  rate: number;
  micDevice: string | null;
}

export const LANGS = [
  { code: "es-ES", label: "Español" }, { code: "en-US", label: "English" }, { code: "pt-BR", label: "Português" },
  { code: "fr-FR", label: "Français" }, { code: "it-IT", label: "Italiano" }, { code: "de-DE", label: "Deutsch" },
];

export default function SettingsPanel({ onClose, settings, onChange, voice }: {
  onClose: () => void; settings: ClientSettings; onChange: (s: ClientSettings) => void; voice: VoiceEngine | null;
}) {
  const [profile, setProfile] = useState<any>({ display_name: "", language: "auto", timezone: "UTC" });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [saved, setSaved] = useState(false);
  const [aiKey, setAiKeyInput] = useState("");
  const [storedKey, setStoredKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sup = voiceSupport();

  useEffect(() => {
    nexus.profile().then(setProfile).catch((e) => setError(e.message));
    setStoredKey(getAiKey());
    const loadVoices = () => setVoices(voice?.voices() ?? []);
    loadVoices();
    if ("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged = loadVoices;
    voice?.inputDevices().then(setMics).catch(() => null);
  }, [voice]);

  const saveProfile = async () => {
    try {
      await nexus.saveProfile({ display_name: profile.display_name || null, language: profile.language, timezone: profile.timezone });
      setSaved(true); setTimeout(() => setSaved(false), 1500);
    } catch (e: any) { setError(e.message); }
  };

  const langVoices = voices.filter((v) => v.lang.startsWith(settings.lang.slice(0, 2)));

  return (
    <Panel title="Settings" onClose={onClose} subtitle="Identity, voice, avatar and display.">
      <ErrorLine error={error} />
      <div className="nx-card space-y-3">
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Identity</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Field label="Name"><input className="nx-input" value={profile.display_name ?? ""} onChange={(e) => setProfile({ ...profile, display_name: e.target.value })} /></Field>
          <Field label="Reply language">
            <select className="nx-input" value={profile.language} onChange={(e) => setProfile({ ...profile, language: e.target.value })}>
              <option value="auto">Auto-detect</option><option value="es">Español</option><option value="en">English</option>
              <option value="pt">Português</option><option value="fr">Français</option>
            </select>
          </Field>
          <Field label="Timezone"><input className="nx-input" value={profile.timezone} onChange={(e) => setProfile({ ...profile, timezone: e.target.value })} /></Field>
        </div>
        <div className="flex gap-2 items-center">
          <Btn variant="primary" onClick={saveProfile}>Save profile</Btn>
          <Btn small onClick={() => setProfile({ ...profile, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use this device's timezone</Btn>
          {saved && <Badge tone="ok">saved</Badge>}
        </div>
        <p className="text-[11px] text-slate-500">Identity uses your MATA account login. No face recognition or biometric identification is performed.</p>
      </div>

      <div className="nx-card space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Clave de IA</h3>
          {storedKey && aiKeyProvider(storedKey)
            ? <Badge tone="ok">{aiKeyProvider(storedKey)} · activa</Badge>
            : <Badge tone="mute">usando la del servidor</Badge>}
        </div>
        <p className="text-[11px] text-slate-400">Pega tu clave de NVIDIA (nvapi-…), Groq (gsk_…), Gemini (AIza…), OpenAI o Anthropic. Se guarda solo en este dispositivo y se usa para tus conversaciones.</p>
        <div className="flex gap-2">
          <input className="nx-input" type="password" autoComplete="off" placeholder={storedKey ? "•••••••• guardada" : "nvapi-…"}
            value={aiKey} onChange={(e) => setAiKeyInput(e.target.value)} aria-label="Clave de IA" />
          <Btn variant="primary" disabled={!aiKeyProvider(aiKey.trim())} onClick={() => { setAiKey(aiKey.trim()); setStoredKey(aiKey.trim()); setAiKeyInput(""); }}>Guardar</Btn>
        </div>
        {aiKey && !aiKeyProvider(aiKey.trim()) && <p className="text-[11px] text-amber-300">Esa clave no tiene un formato reconocido.</p>}
        {storedKey && <Btn small variant="danger" onClick={() => { setAiKey(null); setStoredKey(null); }}>Quitar clave de este dispositivo</Btn>}
      </div>

      <div className="nx-card space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Voice</h3>
          <Badge tone={sup.stt ? "ok" : "warn"}>STT {sup.stt ? "available" : "unsupported"}</Badge>
          <Badge tone={sup.tts ? "ok" : "warn"}>TTS {sup.tts ? "available" : "unsupported"}</Badge>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Field label="Speech language">
            <select className="nx-input" value={settings.lang} onChange={(e) => onChange({ ...settings, lang: e.target.value, voiceURI: null })}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </Field>
          <Field label="Voice">
            <select className="nx-input" value={settings.voiceURI ?? ""} onChange={(e) => onChange({ ...settings, voiceURI: e.target.value || null })}>
              <option value="">Automatic</option>
              {langVoices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
            </select>
          </Field>
          <Field label="Microphone">
            <select className="nx-input" value={settings.micDevice ?? ""} onChange={(e) => onChange({ ...settings, micDevice: e.target.value || null })}>
              <option value="">System default</option>
              {mics.map((m, i) => <option key={m.deviceId || i} value={m.deviceId}>{m.label || `Microphone ${i + 1}`}</option>)}
            </select>
          </Field>
          <Field label={`Speaking rate · ${settings.rate.toFixed(2)}`}>
            <input type="range" min={0.7} max={1.4} step={0.02} value={settings.rate} onChange={(e) => onChange({ ...settings, rate: +e.target.value })} className="w-full accent-cyan-400" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={settings.speak} onChange={(e) => onChange({ ...settings, speak: e.target.checked })} className="accent-cyan-400" />
          Speak replies aloud
        </label>
        <Btn small onClick={() => voice?.say(settings.lang.startsWith("es") ? "Hola, soy NEXUS. Así sueno." : "Hi, I'm NEXUS. This is how I sound.")}>Test voice</Btn>
      </div>

      <div className="nx-card space-y-3">
        <h3 className="nx-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">Avatar & display</h3>
        <Field label="Render quality">
          <div className="flex gap-2">
            {(["low", "medium", "high"] as const).map((q) => (
              <Btn key={q} variant={settings.quality === q ? "primary" : "ghost"} onClick={() => onChange({ ...settings, quality: q })}>{q}</Btn>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap gap-2">
          <a className="nx-btn nx-btn-ghost text-xs px-3.5 py-1.5" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/nexus/?display=tv`} target="_blank" rel="noreferrer">Open TV / display mode ↗</a>
        </div>
        <p className="text-[11px] text-slate-500">Display mode shows only the avatar and live captions — ideal for a TV or large monitor while this PC runs the brain.</p>
      </div>
    </Panel>
  );
}
