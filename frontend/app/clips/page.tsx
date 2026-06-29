"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type Clip = { url: string; title: string; duration: number; start: number; end: number };

const REFRAMES = [
  { id: "center", label: "Recorte centrado", hint: "Rápido. Recorta el centro a 9:16." },
  { id: "face", label: "Seguir al hablante", hint: "Detecta la cara y la mantiene en cuadro." },
];

export default function ClipsPage() {
  const [mode, setMode] = useState<"url" | "file">("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [numClips, setNumClips] = useState(3);
  const [reframe, setReframe] = useState("center");
  const [subs, setSubs] = useState(true);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const pollRef = useRef<any>(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  async function start() {
    setClips([]);
    setMsg("");
    if (mode === "url" && !url.trim()) return setMsg("Pega un enlace de YouTube, Twitch o Kick.");
    if (mode === "file" && !file) return setMsg("Selecciona un archivo de video.");

    const form = new FormData();
    if (mode === "url") form.append("url", url.trim());
    else if (file) form.append("file", file);
    form.append("num_clips", String(numClips));
    form.append("reframe", reframe);
    form.append("burn_subtitles", String(subs));
    form.append("language", "es");

    setStatus("running");
    setMsg("Subiendo y analizando el video… esto puede tardar unos minutos.");
    try {
      const { job_id } = await api.clipsSubmit(form);
      pollRef.current = setInterval(() => poll(job_id), 4000);
    } catch (e: any) {
      setStatus("error");
      setMsg(e.message || "No se pudo iniciar el trabajo.");
    }
  }

  async function poll(id: string) {
    try {
      const r = await api.clipsPoll(id);
      if (r.status === "succeeded") {
        clearInterval(pollRef.current);
        setClips(r.clips || []);
        setStatus("done");
        setMsg(`✓ ${(r.clips || []).length} clips generados.`);
      } else if (r.status === "failed") {
        clearInterval(pollRef.current);
        setStatus("error");
        setMsg(r.error || "El procesamiento falló.");
      }
    } catch {
      /* keep polling */
    }
  }

  const busy = status === "running";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold text-white">Clips virales</h1>
        <p className="text-white/50 mt-1 text-sm">
          Convierte un video largo o un stream de YouTube, Twitch o Kick en clips cortos
          verticales (9:16) listos para TikTok, Reels y Shorts.
        </p>
      </header>

      <div className="liquid-glass rounded-2xl p-5 sm:p-6 space-y-6">
        {/* Source toggle */}
        <div className="flex gap-2">
          {(["url", "file"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-full text-sm transition-all ${
                mode === m ? "bg-white/15 text-white" : "bg-white/5 text-white/50 hover:bg-white/10"
              }`}
            >
              {m === "url" ? "Pegar enlace" : "Subir archivo"}
            </button>
          ))}
        </div>

        {mode === "url" ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…  ·  twitch.tv/videos/…  ·  kick.com/video/…"
            className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-cyan-400/50"
          />
        ) : (
          <label className="block border border-dashed border-white/15 rounded-xl px-4 py-8 text-center cursor-pointer hover:border-cyan-400/40 transition-colors">
            <input
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <span className="text-white/60 text-sm">
              {file ? `📹 ${file.name}` : "Haz clic para elegir un video (.mp4, .mov…)"}
            </span>
          </label>
        )}

        {/* Options */}
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className="text-xs text-white/40 uppercase tracking-wider">Número de clips</label>
            <div className="flex items-center gap-3 mt-2">
              <input
                type="range" min={1} max={10} value={numClips}
                onChange={(e) => setNumClips(Number(e.target.value))}
                className="flex-1 accent-cyan-400"
              />
              <span className="text-white font-medium w-6 text-center">{numClips}</span>
            </div>
          </div>

          <div>
            <label className="text-xs text-white/40 uppercase tracking-wider">Subtítulos automáticos</label>
            <button
              onClick={() => setSubs(!subs)}
              className={`mt-2 px-4 py-2 rounded-full text-sm w-full transition-all ${
                subs ? "bg-cyan-500/20 text-cyan-200" : "bg-white/5 text-white/50"
              }`}
            >
              {subs ? "Activados (estilo TikTok)" : "Desactivados"}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-white/40 uppercase tracking-wider">Reencuadre vertical</label>
          <div className="grid sm:grid-cols-2 gap-3 mt-2">
            {REFRAMES.map((r) => (
              <button
                key={r.id}
                onClick={() => setReframe(r.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  reframe === r.id
                    ? "border-cyan-400/60 bg-cyan-500/10"
                    : "border-white/10 bg-white/5 hover:bg-white/10"
                }`}
              >
                <div className="text-sm text-white font-medium">{r.label}</div>
                <div className="text-xs text-white/40 mt-1">{r.hint}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={start}
          disabled={busy}
          className="btn w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? "Procesando…" : "Generar clips"}
        </button>

        {msg && (
          <p className={`text-sm ${status === "error" ? "text-red-300" : "text-white/50"}`}>
            {busy && <span className="inline-block animate-spin mr-2">⏳</span>}
            {msg}
          </p>
        )}
      </div>

      {/* Results */}
      {clips.length > 0 && (
        <div className="mt-8 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {clips.map((c, i) => (
            <div key={i} className="liquid-glass rounded-2xl overflow-hidden">
              <video
                src={`${api.apiBase}${c.url}`}
                controls
                playsInline
                className="w-full aspect-[9/16] bg-black object-contain"
              />
              <div className="p-3">
                <div className="text-sm text-white font-medium line-clamp-2">{c.title}</div>
                <div className="text-xs text-white/40 mt-1">
                  {c.duration}s · {fmt(c.start)}–{fmt(c.end)}
                </div>
                <a
                  href={`${api.apiBase}${c.url}`}
                  download
                  className="btn-glass text-xs mt-3 inline-flex px-3 py-1.5 rounded-full"
                >
                  ⬇ Descargar
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
