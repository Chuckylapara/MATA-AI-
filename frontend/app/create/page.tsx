"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { downloadFile as download } from "@/services/files";
import Thinking from "@/components/Thinking";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type PromptSet = { principal: string; alternativo: string; cinematografico: string; hiperrealista: string };
type Scene = {
  numero: number;
  duracion_seg: number;
  narracion: string;
  visual: string;
  movimientos: string[];
  emociones: string[];
  sonidos: string[];
  musica: string;
  prompts: PromptSet;
};
type Board = { analysis: any; style_guide: any; escenas: Scene[]; provider?: string; aspect_ratio: string };

const DURATIONS = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1 min", value: 60 },
  { label: "3 min", value: 180 },
  { label: "5 min", value: 300 },
  { label: "10 min", value: 600 },
  { label: "20 min", value: 1200 },
  { label: "30 min", value: 1800 },
  { label: "1 h", value: 3600 },
];
const ASPECTS = [
  { label: "9:16 Vertical", value: "9:16" },
  { label: "16:9 Horizontal", value: "16:9" },
  { label: "1:1 Cuadrado", value: "1:1" },
];
const VOICES = [
  { label: "Narrador", value: "narrador" },
  { label: "Masculino", value: "masculino" },
  { label: "Femenino", value: "femenino" },
  { label: "Niño", value: "nino" },
  { label: "Anciano", value: "anciano" },
  { label: "Cine", value: "cine" },
  { label: "Podcast", value: "podcast" },
];
const SUB_LANGS = [
  { label: "Original", value: "" },
  { label: "Español", value: "es" },
  { label: "Inglés", value: "en" },
  { label: "Francés", value: "fr" },
  { label: "Portugués", value: "pt" },
  { label: "Alemán", value: "de" },
  { label: "Italiano", value: "it" },
];
const PROMPT_KEYS: (keyof PromptSet)[] = ["principal", "alternativo", "cinematografico", "hiperrealista"];
const PROMPT_LABEL: Record<keyof PromptSet, string> = {
  principal: "Principal",
  alternativo: "Alternativo",
  cinematografico: "Cinematográfico",
  hiperrealista: "Hiperrealista",
};

function styleString(sg: any): string {
  if (!sg) return "";
  return [sg.estilo_visual, sg.paleta, sg.iluminacion, sg.ambiente].filter(Boolean).join(", ");
}

export default function CreatePage() {
  const [idea, setIdea] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [aspect, setAspect] = useState("9:16");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [board, setBoard] = useState<Board | null>(null);

  // Per-scene state: selected prompt variant, generated images, loading flag.
  const [picked, setPicked] = useState<Record<number, keyof PromptSet>>({});
  const [images, setImages] = useState<Record<number, string[]>>({});
  const [imgBusy, setImgBusy] = useState<Record<number, boolean>>({});

  // Voice + subtitles state.
  const [voice, setVoice] = useState("narrador");
  const [audio, setAudio] = useState<Record<number, string>>({});
  const [voiceBusy, setVoiceBusy] = useState<Record<number, boolean>>({});
  const [subLang, setSubLang] = useState("");
  const [subBusy, setSubBusy] = useState(false);

  // Render state.
  const [resolution, setResolution] = useState("1080p");
  const [burnSubs, setBurnSubs] = useState(true);
  const [animate, setAnimate] = useState(false);
  const [bgMusic, setBgMusic] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [video, setVideo] = useState<{ url: string; duration: number; resolution: string } | null>(null);

  // Thumbnail (Paso 9 — SEO).
  const [thumb, setThumb] = useState<string | null>(null);
  const [thumbBusy, setThumbBusy] = useState(false);

  // One-click "magic" mode: idea -> guion -> imágenes -> voz -> video, sin pasos manuales.
  const [autoStage, setAutoStage] = useState<"guion" | "video" | null>(null);

  async function autoCreate() {
    if (idea.trim().length < 2) return;
    setBusy(true); setError(""); setBoard(null);
    setImages({}); setPicked({}); setAudio({}); setVideo(null); setThumb(null);
    try {
      setAutoStage("guion");
      const b = await api.studioStoryboard({ idea, target_seconds: seconds, aspect_ratio: aspect });
      setBoard(b);
      setAutoStage("video");
      setRendering(true);
      const escenas = (b.escenas || []).map((s: Scene) => ({
        numero: s.numero,
        duracion_seg: s.duracion_seg,
        narracion: s.narracion,
        prompt: s.prompts?.principal,
        style: styleString(b.style_guide),
      }));
      genThumbnail(b); // fire-and-forget: thumbnail in parallel with the render
      const r = await api.studioRender({
        escenas,
        aspect_ratio: b.aspect_ratio,
        resolution,
        voice,
        language: b.analysis?.idioma || "es",
        burn_subtitles: burnSubs,
        animate,
        background_music: bgMusic,
        title: b.analysis?.titulo,
      });
      setVideo({ url: API_BASE + r.url, duration: r.duration, resolution: r.resolution });
    } catch (e: any) {
      setError(e.message || "Error creando el video automático");
    } finally {
      setBusy(false); setRendering(false); setAutoStage(null);
    }
  }

  async function genThumbnail(b: Board) {
    if (!b?.analysis?.titulo) return;
    setThumbBusy(true);
    try {
      const r = await api.studioThumbnail({
        title: b.analysis.titulo,
        style: styleString(b.style_guide),
        aspect_ratio: b.aspect_ratio === "9:16" ? "9:16" : "16:9",
      });
      if (r.thumbnail) setThumb(r.thumbnail);
    } catch { /* non-blocking */ } finally {
      setThumbBusy(false);
    }
  }

  function downloadScript() {
    if (!board) return;
    const a2 = board.analysis || {};
    const lines: string[] = [];
    lines.push(`${a2.titulo || "Guion"}\n${"=".repeat(40)}`);
    if (a2.descripcion) lines.push(`\n${a2.descripcion}`);
    if (a2.gancho) lines.push(`\nGancho: ${a2.gancho}`);
    if (a2.hashtags?.length) lines.push(`Hashtags: ${a2.hashtags.join(" ")}`);
    lines.push("");
    for (const s of board.escenas || []) {
      lines.push(`\nESCENA ${s.numero}  (${s.duracion_seg}s)\n${"-".repeat(30)}`);
      lines.push(`Narración: ${s.narracion}`);
      lines.push(`Visual: ${s.visual}`);
      if (s.movimientos?.length) lines.push(`Cámara: ${s.movimientos.join(", ")}`);
      if (s.emociones?.length) lines.push(`Emoción: ${s.emociones.join(", ")}`);
      if (s.sonidos?.length) lines.push(`Sonidos: ${s.sonidos.join(", ")}`);
      if (s.musica) lines.push(`Música: ${s.musica}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `guion-${(a2.titulo || "video").slice(0, 30).replace(/\s+/g, "-")}.txt`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  async function generate() {
    setBusy(true);
    setError("");
    setBoard(null);
    setImages({});
    setPicked({});
    setAudio({});
    setVideo(null);
    setThumb(null);
    try {
      const b = await api.studioStoryboard({ idea, target_seconds: seconds, aspect_ratio: aspect });
      setBoard(b);
      genThumbnail(b);
    } catch (e: any) {
      setError(e.message || "Error generando el guion");
    } finally {
      setBusy(false);
    }
  }

  async function genImage(scene: Scene) {
    const key = picked[scene.numero] || "principal";
    setImgBusy((s) => ({ ...s, [scene.numero]: true }));
    try {
      const r = await api.studioSceneImages({
        prompt: scene.prompts[key],
        n: 1,
        aspect_ratio: board!.aspect_ratio,
        style: styleString(board!.style_guide),
      });
      setImages((s) => ({ ...s, [scene.numero]: [...(s[scene.numero] || []), ...(r.images || [])] }));
    } catch (e: any) {
      setError(e.message || "Error generando imagen");
    } finally {
      setImgBusy((s) => ({ ...s, [scene.numero]: false }));
    }
  }

  async function genVoice(scene: Scene) {
    setVoiceBusy((s) => ({ ...s, [scene.numero]: true }));
    try {
      const r = await api.studioVoiceover({
        text: scene.narracion,
        voice,
        language: board?.analysis?.idioma || "es",
      });
      if (r.audio) setAudio((s) => ({ ...s, [scene.numero]: r.audio }));
    } catch (e: any) {
      setError(e.message || "Error generando voz");
    } finally {
      setVoiceBusy((s) => ({ ...s, [scene.numero]: false }));
    }
  }

  async function downloadSubs(fmt: "srt" | "vtt") {
    if (!board) return;
    setSubBusy(true);
    try {
      const r = await api.studioSubtitles({ escenas: board.escenas, fmt, language: subLang || null });
      const blob = new Blob([r.content], { type: r.mime });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = r.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message || "Error generando subtítulos");
    } finally {
      setSubBusy(false);
    }
  }

  async function renderVideo() {
    if (!board) return;
    setRendering(true);
    setError("");
    setVideo(null);
    try {
      const escenas = board.escenas.map((s) => ({
        numero: s.numero,
        duracion_seg: s.duracion_seg,
        narracion: s.narracion,
        prompt: s.prompts?.[picked[s.numero] || "principal"],
        image_url: images[s.numero]?.[0], // reuse an already-generated image if present
        style: styleString(board.style_guide),
      }));
      const r = await api.studioRender({
        escenas,
        aspect_ratio: board.aspect_ratio,
        resolution,
        voice,
        language: board.analysis?.idioma || "es",
        burn_subtitles: burnSubs,
        animate,
        background_music: bgMusic,
        title: board.analysis?.titulo,
      });
      setVideo({ url: API_BASE + r.url, duration: r.duration, resolution: r.resolution });
    } catch (e: any) {
      setError(e.message || "Error generando el video");
    } finally {
      setRendering(false);
    }
  }

  const a = board?.analysis;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">
          Viral AI <span style={{ background: "linear-gradient(90deg,#a78bfa,#22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>Studio</span>
        </h1>
        <p className="text-sm text-zinc-400">Una idea → guion por escenas, prompts e imágenes consistentes.</p>
      </div>

      {/* Idea form */}
      <div className="card space-y-4">
        <textarea
          className="input h-24"
          placeholder="Escribe tu idea… ej: «Historia de un tiburón gigante en el océano»"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
        />
        <div className="flex flex-wrap gap-6">
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Duración</p>
            <div className="flex flex-wrap gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.value}
                  onClick={() => setSeconds(d.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${seconds === d.value ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/15 text-zinc-300"}`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Formato</p>
            <div className="flex flex-wrap gap-2">
              {ASPECTS.map((x) => (
                <button
                  key={x.value}
                  onClick={() => setAspect(x.value)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${aspect === x.value ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/15 text-zinc-300"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs uppercase tracking-wide text-zinc-500">Voz</p>
            <select
              className="input !py-1.5 text-sm"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              {VOICES.map((v) => (
                <option key={v.value} value={v.value}>{v.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn !px-6" onClick={autoCreate} disabled={busy || idea.trim().length < 2}>
            {autoStage ? "Creando tu video…" : "⚡ Crear video automático"}
          </button>
          <button className="btn-glass !py-2 text-sm" onClick={generate} disabled={busy || idea.trim().length < 2}>
            {busy && !autoStage ? "Generando guion…" : "Paso a paso"}
          </button>
          <span className="text-xs text-zinc-500">1 clic = idea → guion → imágenes → voz → video</span>
        </div>
        {busy && (
          <div className="pt-1">
            <Thinking label={
              autoStage === "video"
                ? "Montando el video: imágenes + voz + edición… (puede tardar varios minutos)"
                : autoStage === "guion"
                ? "Escribiendo el guion por escenas…"
                : "Analizando idea y escribiendo escenas…"
            } />
          </div>
        )}
        {error && <p className="text-sm text-red-400">⚠️ {error}</p>}
      </div>

      {/* Analysis */}
      {a && (
        <div className="card mt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{a.titulo}</h2>
            {board?.provider && (
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-zinc-300">motor: {board.provider}</span>
            )}
          </div>
          <p className="mb-3 text-sm text-zinc-300">{a.descripcion}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400 sm:grid-cols-3">
            <Meta k="Categoría" v={a.categoria} />
            <Meta k="Tono" v={a.tono} />
            <Meta k="Audiencia" v={a.audiencia} />
            <Meta k="Idioma" v={a.idioma} />
            <Meta k="Formato" v={a.formato} />
            <Meta k="Duración" v={`${a.duracion_recomendada_seg}s`} />
          </div>
          {a.gancho && <p className="mt-3 text-sm"><span className="text-zinc-500">Gancho: </span>{a.gancho}</p>}
          {!!(a.hashtags?.length) && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.hashtags.map((h: string) => (
                <span key={h} className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-xs text-cyan-300">{h}</span>
              ))}
            </div>
          )}

          {/* Thumbnail (Paso 9) */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-sm font-semibold text-violet-300">🖼️ Miniatura</span>
              {thumbBusy && <span className="text-xs text-zinc-500">generando…</span>}
              {thumb && (
                <button className="btn-glass !py-1 text-xs" onClick={() => download(thumb, "miniatura.jpg")}>
                  ⬇ Descargar miniatura
                </button>
              )}
              {!thumb && !thumbBusy && board && (
                <button className="btn-glass !py-1 text-xs" onClick={() => genThumbnail(board)}>
                  Generar miniatura
                </button>
              )}
            </div>
            {thumb && <img src={thumb} alt="miniatura" className="w-full max-w-md rounded-xl border border-white/10" />}
          </div>
        </div>
      )}

      {/* Subtitles toolbar */}
      {board?.escenas?.length ? (
        <div className="card mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold text-violet-300">📝 Subtítulos</span>
          <select className="input !w-auto !py-1.5 text-sm" value={subLang} onChange={(e) => setSubLang(e.target.value)}>
            {SUB_LANGS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
          <button className="btn !py-1.5 text-sm" onClick={() => downloadSubs("srt")} disabled={subBusy}>
            {subBusy ? "Generando…" : "⬇ .SRT"}
          </button>
          <button className="btn !py-1.5 text-sm" onClick={() => downloadSubs("vtt")} disabled={subBusy}>
            {subBusy ? "Generando…" : "⬇ .VTT"}
          </button>
          <button className="btn-glass !py-1.5 text-sm" onClick={downloadScript}>
            ⬇ Guion (.txt)
          </button>
        </div>
      ) : null}

      {/* Render to MP4 */}
      {board?.escenas?.length ? (
        <div className="card mt-4 border border-violet-500/30">
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <span className="text-sm font-semibold text-violet-300">🎬 Montar video (.mp4)</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">Resolución</span>
              {["720p", "1080p"].map((r) => (
                <button
                  key={r}
                  onClick={() => setResolution(r)}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${resolution === r ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/15 text-zinc-300"}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300">
              <input type="checkbox" checked={burnSubs} onChange={(e) => setBurnSubs(e.target.checked)} />
              Subtítulos incrustados
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300" title="Requiere KIE_API_KEY">
              <input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} />
              Animar con IA <span className="text-zinc-500">(kie.ai)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-300" title="Requiere KIE_API_KEY">
              <input type="checkbox" checked={bgMusic} onChange={(e) => setBgMusic(e.target.checked)} />
              Música de fondo <span className="text-zinc-500">(kie.ai)</span>
            </label>
          </div>
          <button className="btn" onClick={renderVideo} disabled={rendering}>
            {rendering ? "Montando video…" : "🎬 Generar video completo"}
          </button>
          {rendering && (
            <div className="pt-2">
              <Thinking label="Generando imágenes, voz y ensamblando el .mp4… (puede tardar)" />
            </div>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            Usa las imágenes y la voz de cada escena (las genera si faltan). {board.escenas.length} escenas · {board.aspect_ratio}.
          </p>

          {video && (
            <div className="mt-4">
              <video src={video.url} controls className="mx-auto max-h-[70vh] rounded-xl border border-white/10" />
              <div className="mt-2 flex items-center gap-3">
                <span className="text-xs text-zinc-400">{video.resolution} · {video.duration}s</span>
                <button className="btn !py-1.5 text-sm" onClick={() => download(video.url, "viral-ai-studio.mp4")}>
                  ⬇ Descargar video
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* Style guide */}
      {board?.style_guide && Object.keys(board.style_guide).length > 0 && (
        <div className="card mt-4">
          <h3 className="mb-2 text-sm font-semibold text-violet-300">🎨 Biblia visual (consistencia)</h3>
          <div className="grid grid-cols-1 gap-1.5 text-xs text-zinc-400 sm:grid-cols-2">
            {Object.entries(board.style_guide).filter(([k]) => !k.startsWith("_")).map(([k, v]) => (
              <Meta key={k} k={k} v={String(v)} />
            ))}
          </div>
        </div>
      )}

      {/* Scenes */}
      {board?.escenas?.map((scene) => {
        const key = picked[scene.numero] || "principal";
        return (
          <div key={scene.numero} className="card mt-4">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-sm font-bold text-white">
                {scene.numero}
              </span>
              <span className="text-xs text-zinc-500">{scene.duracion_seg}s</span>
            </div>
            <p className="mb-2 text-sm text-zinc-200">🎙️ {scene.narracion}</p>
            <p className="mb-3 text-sm text-zinc-400">🎬 {scene.visual}</p>
            <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-zinc-500">
              {!!scene.movimientos?.length && <span>📷 {scene.movimientos.join(", ")}</span>}
              {!!scene.emociones?.length && <span>💜 {scene.emociones.join(", ")}</span>}
              {!!scene.sonidos?.length && <span>🔊 {scene.sonidos.join(", ")}</span>}
              {scene.musica && <span>🎵 {scene.musica}</span>}
            </div>

            {/* Prompt variant picker */}
            <div className="mb-2 flex flex-wrap gap-2">
              {PROMPT_KEYS.filter((pk) => scene.prompts?.[pk]).map((pk) => (
                <button
                  key={pk}
                  onClick={() => setPicked((s) => ({ ...s, [scene.numero]: pk }))}
                  className={`rounded-lg border px-2.5 py-1 text-xs ${key === pk ? "border-cyan-400 bg-cyan-400/15 text-white" : "border-white/15 text-zinc-400"}`}
                >
                  {PROMPT_LABEL[pk]}
                </button>
              ))}
            </div>
            <p className="mb-3 rounded-lg bg-black/30 p-2 font-mono text-[11px] text-zinc-400">{scene.prompts?.[key]}</p>

            <div className="flex flex-wrap gap-2">
              <button className="btn !py-1.5 text-sm" onClick={() => genImage(scene)} disabled={imgBusy[scene.numero]}>
                {imgBusy[scene.numero] ? "Generando imagen…" : "🖼️ Generar imagen"}
              </button>
              <button className="btn !py-1.5 text-sm" onClick={() => genVoice(scene)} disabled={voiceBusy[scene.numero]}>
                {voiceBusy[scene.numero] ? "Generando voz…" : "🎙️ Generar voz"}
              </button>
            </div>

            {audio[scene.numero] && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <audio src={audio[scene.numero]} controls className="h-9 max-w-full" />
                <button className="btn !py-1 text-xs" onClick={() => download(audio[scene.numero], `voz-escena-${scene.numero}.mp3`)}>
                  ⬇ Descargar voz
                </button>
              </div>
            )}

            {!!images[scene.numero]?.length && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {images[scene.numero].map((src, i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <img src={src} alt="" className="rounded-lg border border-white/10" />
                    <button className="btn !py-1 text-xs" onClick={() => download(src, `escena-${scene.numero}-${i + 1}.jpg`)}>
                      ⬇ Descargar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <span className="text-zinc-600">{k}: </span>
      <span className="text-zinc-300">{v}</span>
    </div>
  );
}
