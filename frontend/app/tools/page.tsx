"use client";
import { useState } from "react";
import { api } from "@/lib/api";

const LANGS = [
  { code: "es", label: "Español" },
  { code: "en", label: "Inglés" },
  { code: "fr", label: "Francés" },
];
// Pares confirmados disponibles gratis.
const PAIRS = new Set(["en-es", "es-en", "en-fr", "fr-en"]);

export default function ToolsPage() {
  const [tab, setTab] = useState<"translate" | "summarize" | "vision">("translate");

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-semibold text-white">Herramientas IA</h1>
        <p className="text-white/50 mt-1 text-sm">
          Utilidades de texto gratis con IA: traduce y resume al instante.
        </p>
      </header>

      <div className="flex gap-2 mb-6">
        {([["translate", "🌐 Traductor"], ["summarize", "📝 Resumen"], ["vision", "👁️ Analizar imagen"]] as const).map(([id, label]) => (
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

      {tab === "translate" && <Translator />}
      {tab === "summarize" && <Summarizer />}
      {tab === "vision" && <Vision />}
    </div>
  );
}

// Lee una imagen y la redimensiona en el navegador (máx 1024px, JPEG) para
// que el envío sea rápido y ligero.
function resizeImage(file: File, max = 1024): Promise<string> {
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
        canvas.width = width;
        canvas.height = height;
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

function Vision() {
  const [preview, setPreview] = useState("");
  const [question, setQuestion] = useState("Describe esta imagen en detalle.");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function onFile(file: File | null) {
    setErr(""); setOut("");
    if (!file) return;
    try {
      setPreview(await resizeImage(file));
    } catch {
      setErr("No se pudo leer la imagen.");
    }
  }

  async function run() {
    setErr(""); setOut("");
    if (!preview) { setErr("Sube una imagen primero."); return; }
    setBusy(true);
    try {
      const r = await api.vision({ image: preview, question });
      setOut(r.answer || "");
    } catch (e: any) {
      setErr(e.message || "Error al analizar la imagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <label className="block border border-dashed border-white/15 rounded-xl px-4 py-6 text-center cursor-pointer hover:border-cyan-400/40 transition-colors">
        <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0] || null)} />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="preview" className="max-h-56 mx-auto rounded-lg" />
        ) : (
          <span className="text-white/60 text-sm">Haz clic para subir una imagen</span>
        )}
      </label>
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="¿Qué quieres saber de la imagen?"
        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
      />
      <button onClick={run} disabled={busy} className="btn w-full py-3 disabled:opacity-50">
        {busy ? "Analizando…" : "Analizar imagen"}
      </button>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {out && (
        <div className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/90 whitespace-pre-wrap">
          {out}
        </div>
      )}
    </div>
  );
}

function Translator() {
  const [text, setText] = useState("");
  const [source, setSource] = useState("en");
  const [target, setTarget] = useState("es");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const pairOk = source === target || PAIRS.has(`${source}-${target}`);

  async function run() {
    setErr(""); setOut("");
    if (!text.trim()) return;
    if (!pairOk) { setErr("Ese par de idiomas no está disponible gratis. Prueba es↔en o en→fr."); return; }
    setBusy(true);
    try {
      const r = await api.translate({ text, source, target });
      setOut(r.translation || "");
    } catch (e: any) {
      setErr(e.message || "Error al traducir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        <Select value={source} onChange={setSource} />
        <span className="text-white/40">→</span>
        <Select value={target} onChange={setTarget} />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Escribe el texto a traducir…"
        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-400/50 resize-y"
      />
      <button onClick={run} disabled={busy} className="btn w-full py-3 disabled:opacity-50">
        {busy ? "Traduciendo…" : "Traducir"}
      </button>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {out && (
        <div className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/90 whitespace-pre-wrap">
          {out}
        </div>
      )}
    </div>
  );
}

function Summarizer() {
  const [text, setText] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setErr(""); setOut("");
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api.summarize(text);
      setOut(r.summary || "");
    } catch (e: any) {
      setErr(e.message || "Error al resumir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="liquid-glass rounded-2xl p-5 space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        placeholder="Pega un texto largo y lo resumo…"
        className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-400/50 resize-y"
      />
      <button onClick={run} disabled={busy} className="btn w-full py-3 disabled:opacity-50">
        {busy ? "Resumiendo…" : "Resumir"}
      </button>
      {err && <p className="text-sm text-red-300">{err}</p>}
      {out && (
        <div className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/90 whitespace-pre-wrap">
          {out}
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/50"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code} className="bg-zinc-900">{l.label}</option>
      ))}
    </select>
  );
}
