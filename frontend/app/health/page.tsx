"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Tab = "chat" | "scan" | "vitals" | "profile" | "report" | "wellness";

const TABS: [Tab, string][] = [
  ["chat", "💬 Síntomas"],
  ["scan", "📷 Escáner"],
  ["vitals", "❤️ Vitales"],
  ["profile", "🧾 Perfil"],
  ["report", "📄 Reporte"],
  ["wellness", "🌿 Bienestar"],
];

export default function HealthPage() {
  const [tab, setTab] = useState<Tab>("chat");
  const [emergency, setEmergency] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 via-cyan-500 to-violet-600 flex items-center justify-center shadow-lg shadow-cyan-500/30 shrink-0">
            <span className="text-white text-lg">🩺</span>
          </div>
          <div>
            <h1 className="text-3xl font-semibold text-white">Mata Health AI</h1>
            <p className="text-white/50 mt-0.5 text-sm">
              Asistente de prevención y bienestar. No reemplaza a un médico.
            </p>
          </div>
        </div>
      </header>

      {emergency && (
        <div className="mb-6 rounded-2xl border border-red-500/40 bg-red-950/40 px-5 py-4 flex items-start gap-3 animate-pulse">
          <span className="text-2xl">🚨</span>
          <div>
            <p className="text-red-200 font-semibold">Busca ayuda médica de emergencia ahora</p>
            <p className="text-red-300/80 text-sm mt-0.5">{emergency}</p>
          </div>
          <button onClick={() => setEmergency(null)} className="ml-auto text-red-300/60 hover:text-red-200 text-sm">
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-6">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-full text-sm transition-all ${
              tab === id ? "bg-white/15 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "chat" && <SymptomChat onEmergency={setEmergency} />}
      {tab === "scan" && <Scanner onEmergency={setEmergency} />}
      {tab === "vitals" && <Vitals onEmergency={setEmergency} />}
      {tab === "profile" && <ProfileForm />}
      {tab === "report" && <WeeklyReport />}
      {tab === "wellness" && <Wellness />}

      <p className="mt-8 text-center text-[11px] text-white/30 leading-relaxed">
        Mata Health AI ofrece orientación preventiva generada por inteligencia artificial y no sustituye una
        consulta médica profesional. En una emergencia, contacta a los servicios de emergencia de tu localidad.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Symptom chat
// ---------------------------------------------------------------------------
function SymptomChat({ onEmergency }: { onEmergency: (m: string | null) => void }) {
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([
    { role: "assistant", content: "Hola, soy tu asistente de síntomas. Cuéntame qué sientes y te ayudo a organizarlo." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [followUps, setFollowUps] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setErr("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: text }]);
    setInput("");
    setFollowUps([]);
    setBusy(true);
    try {
      const r = await api.healthChat({ message: text, history });
      setMessages((m) => [...m, { role: "assistant", content: r.reply || "" }]);
      setFollowUps(r.follow_up_questions || []);
      if (r.emergency) onEmergency(r.emergency_reason || "Señal de emergencia detectada en tus síntomas.");
    } catch (e: any) {
      setErr(e.message || "Error al enviar el mensaje.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 flex flex-col h-[70vh]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                m.role === "user" ? "bg-cyan-600/30 text-white" : "bg-white/8 text-white/90"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-white/40 text-sm">Pensando…</div>}
        <div ref={bottomRef} />
      </div>

      {followUps.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {followUps.map((q, i) => (
            <button
              key={i}
              onClick={() => send(q)}
              className="text-xs bg-white/8 hover:bg-white/15 text-white/70 rounded-full px-3 py-1.5 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {err && <p className="text-sm text-red-300 mt-2">{err}</p>}

      <div className="flex gap-2 mt-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Describe lo que sientes…"
          className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
        />
        <button onClick={() => send(input)} disabled={busy} className="btn px-5 disabled:opacity-50">
          Enviar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Camera scanner
// ---------------------------------------------------------------------------
const AREAS: [string, string][] = [
  ["general", "General"], ["rostro", "Rostro"], ["piel", "Piel"], ["ojos", "Ojos"],
  ["labios", "Labios"], ["manos", "Manos"], ["lunar", "Lunar"], ["herida", "Herida"], ["postura", "Postura"],
];

function resizeFile(file: File, max = 900): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > max || height > max) {
          const s = max / Math.max(width, height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function Scanner({ onEmergency }: { onEmergency: (m: string | null) => void }) {
  const [area, setArea] = useState("general");
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(false);

  async function openCamera() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamOn(true);
    } catch {
      setErr("No se pudo acceder a la cámara. Revisa los permisos del navegador.");
    }
  }

  function closeCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCamOn(false);
  }

  function capture() {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const canvas = document.createElement("canvas");
    const max = 900;
    const scale = Math.min(1, max / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setPreview(canvas.toDataURL("image/jpeg", 0.85));
    closeCamera();
  }

  async function onFile(file: File | null) {
    setErr(""); setResult(null);
    if (!file) return;
    try {
      setPreview(await resizeFile(file));
    } catch {
      setErr("No se pudo leer la imagen.");
    }
  }

  async function analyze() {
    if (!preview) { setErr("Toma o sube una foto primero."); return; }
    setErr(""); setBusy(true); setResult(null);
    try {
      const r = await api.healthScan({ image: preview, area });
      setResult(r);
      if (r.severity === "urgent") onEmergency(`Escáner (${area}): ${r.recommendation}`);
    } catch (e: any) {
      setErr(e.message || "Error al analizar la imagen.");
    } finally {
      setBusy(false);
    }
  }

  const severityStyle: Record<string, string> = {
    normal: "text-emerald-300 border-emerald-500/30 bg-emerald-950/30",
    watch: "text-amber-300 border-amber-500/30 bg-amber-950/30",
    urgent: "text-red-300 border-red-500/30 bg-red-950/30",
  };

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap gap-2">
        {AREAS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setArea(id)}
            className={`text-xs rounded-full px-3 py-1.5 transition-colors ${
              area === id ? "bg-cyan-500/25 text-cyan-200" : "bg-white/5 text-white/50 hover:bg-white/10"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {camOn ? (
        <div className="space-y-2">
          <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-xl max-h-72 object-cover" />
          <div className="flex gap-2">
            <button onClick={capture} className="btn flex-1 py-3">📸 Capturar</button>
            <button onClick={closeCamera} className="btn-glass px-4 py-3">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button onClick={openCamera} className="btn flex-1 py-3">📷 Usar cámara</button>
          <label className="btn-glass flex-1 py-3 text-center cursor-pointer">
            🖼️ Subir foto
            <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
          </label>
        </div>
      )}

      {preview && !camOn && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="preview" className="max-h-64 mx-auto rounded-xl" />
      )}

      {preview && !camOn && (
        <button onClick={analyze} disabled={busy} className="btn w-full py-3 disabled:opacity-50">
          {busy ? "Analizando…" : "Analizar con IA"}
        </button>
      )}

      {err && <p className="text-sm text-red-300">{err}</p>}

      {result && (
        <div className={`rounded-xl border px-4 py-3 space-y-2 ${severityStyle[result.severity] || severityStyle.watch}`}>
          <p className="text-xs uppercase tracking-wide opacity-70">Severidad: {result.severity}</p>
          <p className="text-sm text-white/90">{result.observations}</p>
          <p className="text-sm font-medium">{result.recommendation}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vitals: camera heart rate (PPG), step counter, fall detection
// ---------------------------------------------------------------------------
function Vitals({ onEmergency }: { onEmergency: (m: string | null) => void }) {
  return (
    <div className="space-y-5">
      <HeartRateMonitor onEmergency={onEmergency} />
      <MotionMonitor onEmergency={onEmergency} />
    </div>
  );
}

function HeartRateMonitor({ onEmergency }: { onEmergency: (m: string | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>();
  const [measuring, setMeasuring] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const samplesRef = useRef<{ t: number; v: number }[]>([]);

  async function start() {
    setErr(""); setBpm(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: 160, height: 120 },
      });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      try {
        await track.applyConstraints({ advanced: [{ torch: true } as any] });
      } catch {
        /* torch not supported — measurement still works with ambient light, just noisier */
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      samplesRef.current = [];
      setMeasuring(true);
      const canvas = document.createElement("canvas");
      canvas.width = 40; canvas.height = 30;
      const ctx = canvas.getContext("2d")!;
      const startTime = performance.now();

      const tick = () => {
        const v = videoRef.current;
        if (v && v.videoWidth) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let sum = 0;
          for (let i = 0; i < frame.length; i += 4) sum += frame[i]; // red channel
          const avg = sum / (frame.length / 4);
          samplesRef.current.push({ t: performance.now(), v: avg });
        }
        if (performance.now() - startTime < 15000) {
          rafRef.current = requestAnimationFrame(tick);
        } else {
          finish();
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      setErr("No se pudo acceder a la cámara. Cubre la cámara trasera con el dedo y permite el acceso.");
      setMeasuring(false);
    }
  }

  function finish() {
    stop();
    const samples = samplesRef.current;
    if (samples.length < 30) {
      setErr("No se detectó suficiente señal. Cubre bien la cámara con el dedo, sin presionar demasiado.");
      return;
    }
    // Detrend with a simple moving average, then count peaks above a rolling threshold.
    const win = 5;
    const smoothed = samples.map((s, i) => {
      const lo = Math.max(0, i - win), hi = Math.min(samples.length, i + win);
      const slice = samples.slice(lo, hi);
      return { t: s.t, v: slice.reduce((a, b) => a + b.v, 0) / slice.length };
    });
    const values = smoothed.map((s) => s.v);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    let peaks = 0;
    let lastPeakT = 0;
    for (let i = 1; i < smoothed.length - 1; i++) {
      const s = smoothed[i];
      if (s.v > mean && s.v > smoothed[i - 1].v && s.v >= smoothed[i + 1].v && s.t - lastPeakT > 300) {
        peaks++;
        lastPeakT = s.t;
      }
    }
    const durationSec = (samples[samples.length - 1].t - samples[0].t) / 1000;
    const estimated = Math.round((peaks / durationSec) * 60);
    if (estimated < 35 || estimated > 200) {
      setErr("La lectura no fue confiable. Vuelve a intentarlo cubriendo bien la cámara con el dedo.");
      return;
    }
    setBpm(estimated);
    api.healthVitals({ kind: "heart_rate", value: estimated }).then((r) => {
      if (r.severity === "watch") onEmergency(null);
    }).catch(() => {});
    if (estimated < 40 || estimated > 160) {
      onEmergency(`Ritmo cardíaco estimado inusual: ${estimated} lpm. Considera medirlo con un dispositivo médico.`);
    }
  }

  function stop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setMeasuring(false);
  }

  useEffect(() => () => stop(), []);

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-3">
      <h3 className="text-white font-medium">❤️ Ritmo cardíaco (cámara)</h3>
      <p className="text-white/50 text-sm">
        Coloca la yema del dedo cubriendo por completo la cámara trasera y el flash, sin presionar fuerte. Mide 15
        segundos. Es una estimación aproximada (fotopletismografía), no un dispositivo médico certificado.
      </p>
      <video ref={videoRef} className="hidden" muted playsInline />
      {!measuring ? (
        <button onClick={start} className="btn w-full py-3">Medir ritmo cardíaco</button>
      ) : (
        <div className="text-center py-6">
          <div className="text-3xl mb-2 animate-pulse">💓</div>
          <p className="text-white/70 text-sm">Midiendo… mantén el dedo quieto sobre la cámara</p>
        </div>
      )}
      {bpm !== null && (
        <div className="text-center bg-black/30 border border-white/10 rounded-xl py-4">
          <span className="text-4xl font-semibold text-cyan-300">{bpm}</span>
          <span className="text-white/50 text-sm ml-2">lpm estimados</span>
        </div>
      )}
      {err && <p className="text-sm text-red-300">{err}</p>}
    </div>
  );
}

function MotionMonitor({ onEmergency }: { onEmergency: (m: string | null) => void }) {
  const [active, setActive] = useState(false);
  const [steps, setSteps] = useState(0);
  const [supported, setSupported] = useState(true);
  const lastStepRef = useRef(0);
  const wasHighRef = useRef(false);
  const lastPeakMagRef = useRef(0);
  const highSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof DeviceMotionEvent === "undefined") setSupported(false);
  }, []);

  async function toggle() {
    if (active) { setActive(false); return; }
    // iOS 13+ requires an explicit permission prompt triggered by a user gesture.
    const DME: any = DeviceMotionEvent as any;
    if (typeof DME?.requestPermission === "function") {
      try {
        const perm = await DME.requestPermission();
        if (perm !== "granted") { setSupported(false); return; }
      } catch {
        setSupported(false);
        return;
      }
    }
    setActive(true);
  }

  useEffect(() => {
    if (!active) return;
    const STEP_THRESHOLD = 12; // m/s^2 above gravity, tuned for a walking gait
    const FALL_THRESHOLD = 28; // sudden high-g spike consistent with an impact

    function onMotion(e: DeviceMotionEvent) {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2);
      const now = performance.now();

      if (mag > STEP_THRESHOLD && !wasHighRef.current && now - lastStepRef.current > 300) {
        wasHighRef.current = true;
        lastStepRef.current = now;
        setSteps((s) => {
          const next = s + 1;
          if (next % 20 === 0) api.healthVitals({ kind: "steps", value: next }).catch(() => {});
          return next;
        });
      } else if (mag < STEP_THRESHOLD * 0.7) {
        wasHighRef.current = false;
      }

      if (mag > FALL_THRESHOLD) {
        highSinceRef.current = now;
      }
      if (highSinceRef.current && now - highSinceRef.current < 1500 && mag < 3) {
        highSinceRef.current = null;
        api.healthVitals({ kind: "fall", note: "Posible caída detectada por el acelerómetro." }).catch(() => {});
        onEmergency("Se detectó un posible impacto seguido de inmovilidad. Verifica que estés bien.");
      }
      lastPeakMagRef.current = mag;
    }

    window.addEventListener("devicemotion", onMotion);
    return () => window.removeEventListener("devicemotion", onMotion);
  }, [active, onEmergency]);

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-3">
      <h3 className="text-white font-medium">🚶 Movimiento (acelerómetro)</h3>
      <p className="text-white/50 text-sm">
        Conteo de pasos y detección de caídas usando el sensor de movimiento del teléfono. Funciona en el navegador
        móvil (Chrome/Safari); en computadora de escritorio no hay acelerómetro disponible.
      </p>
      {!supported && <p className="text-amber-300 text-sm">Este dispositivo no expone sensores de movimiento al navegador.</p>}
      <div className="flex items-center gap-4">
        <button onClick={toggle} disabled={!supported} className="btn px-5 py-3 disabled:opacity-50">
          {active ? "Detener" : "Iniciar seguimiento"}
        </button>
        <div className="text-center">
          <div className="text-2xl font-semibold text-white">{steps}</div>
          <div className="text-white/40 text-xs">pasos hoy</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------
function ProfileForm() {
  const [p, setP] = useState<any>({});
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.healthProfileGet().then((r) => setP(r.profile || {})).catch(() => {});
  }, []);

  function field(key: string, label: string, type = "text") {
    return (
      <label className="block">
        <span className="text-white/50 text-xs">{label}</span>
        <input
          type={type}
          value={p[key] ?? ""}
          onChange={(e) => setP({ ...p, [key]: type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })}
          className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50"
        />
      </label>
    );
  }

  async function save() {
    setBusy(true); setErr(""); setSaved(false);
    try {
      await api.healthProfileSave(p);
      setSaved(true);
    } catch (e: any) {
      setErr(e.message || "Error al guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    setBusy(true);
    try {
      await api.healthDeleteData();
      setP({});
      setConfirmDelete(false);
    } catch (e: any) {
      setErr(e.message || "Error al borrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {field("full_name", "Nombre completo")}
        {field("age", "Edad", "number")}
        {field("weight_kg", "Peso (kg)", "number")}
        {field("height_cm", "Altura (cm)", "number")}
      </div>
      <label className="block">
        <span className="text-white/50 text-xs">Alergias</span>
        <textarea
          value={p.allergies ?? ""}
          onChange={(e) => setP({ ...p, allergies: e.target.value })}
          rows={2}
          className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50 resize-y"
        />
      </label>
      <label className="block">
        <span className="text-white/50 text-xs">Medicamentos actuales</span>
        <textarea
          value={p.medications ?? ""}
          onChange={(e) => setP({ ...p, medications: e.target.value })}
          rows={2}
          className="mt-1 w-full bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50 resize-y"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        {field("emergency_contact_name", "Contacto de emergencia")}
        {field("emergency_contact_phone", "Teléfono de emergencia")}
      </div>

      <button onClick={save} disabled={busy} className="btn w-full py-3 disabled:opacity-50">
        {busy ? "Guardando…" : "Guardar perfil"}
      </button>
      {saved && <p className="text-emerald-300 text-sm text-center">Perfil guardado.</p>}
      {err && <p className="text-red-300 text-sm text-center">{err}</p>}

      <div className="border-t border-white/10 pt-4">
        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} className="text-red-300/70 hover:text-red-300 text-xs">
            Borrar todos mis datos de salud
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-red-300 text-xs">¿Seguro? Esto borra perfil, historial y escaneos.</span>
            <button onClick={wipe} className="text-red-300 text-xs underline">Sí, borrar</button>
            <button onClick={() => setConfirmDelete(false)} className="text-white/50 text-xs underline">Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Weekly report
// ---------------------------------------------------------------------------
function WeeklyReport() {
  const [report, setReport] = useState<any>(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setBusy(true); setErr("");
    try {
      const r = await api.healthWeeklyReport();
      setReport(r.report);
      setCount(r.entry_count);
    } catch (e: any) {
      setErr(e.message || "Error al generar el reporte.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">Reporte semanal</h3>
        <div className="flex gap-2">
          <button onClick={generate} disabled={busy} className="btn px-4 py-2 text-sm disabled:opacity-50">
            {busy ? "Generando…" : "Generar reporte"}
          </button>
          {report && (
            <button onClick={() => window.print()} className="btn-glass px-4 py-2 text-sm">
              Exportar PDF
            </button>
          )}
        </div>
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {report && (
        <div id="health-report-print" className="space-y-4 bg-black/30 border border-white/10 rounded-xl p-5">
          <p className="text-white/50 text-xs">Basado en {count} eventos registrados en los últimos 7 días.</p>
          <Section title="Resumen" text={report.summary} />
          <ListSection title="Cambios detectados" items={report.changes_detected} />
          <ListSection title="Síntomas reportados" items={report.symptoms_recap} />
          <ListSection title="Preguntas sugeridas para tu médico" items={report.questions_for_doctor} />
        </div>
      )}
    </div>
  );
}

function Section({ title, text }: { title: string; text?: string }) {
  if (!text) return null;
  return (
    <div>
      <h4 className="text-white/70 text-sm font-medium mb-1">{title}</h4>
      <p className="text-white/90 text-sm">{text}</p>
    </div>
  );
}

function ListSection({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 className="text-white/70 text-sm font-medium mb-1">{title}</h4>
      <ul className="list-disc list-inside space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-white/90 text-sm">{it}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wellness
// ---------------------------------------------------------------------------
function Wellness() {
  const [tips, setTips] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setBusy(true); setErr("");
    try {
      const r = await api.healthWellness();
      setTips(r.tips);
    } catch (e: any) {
      setErr(e.message || "Error al generar recomendaciones.");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = tips
    ? [["😴 Sueño", tips.sleep], ["💧 Hidratación", tips.hydration], ["🏃 Actividad física", tips.activity], ["🥗 Alimentación", tips.nutrition], ["✅ Hábitos", tips.habits]]
    : [];

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-white font-medium">Recomendaciones de bienestar</h3>
        <button onClick={load} disabled={busy} className="btn px-4 py-2 text-sm disabled:opacity-50">
          {busy ? "Generando…" : tips ? "Actualizar" : "Generar"}
        </button>
      </div>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {rows.map(([label, text]) => (
        <div key={label} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/60 text-xs mb-1">{label}</p>
          <p className="text-white/90 text-sm">{text}</p>
        </div>
      ))}
    </div>
  );
}
