"use client";
import { useState } from "react";
import { api } from "@/lib/api";

const TABS = ["image", "video", "music", "code", "agent"] as const;
type Tab = (typeof TABS)[number];

export default function StudioPage() {
  const [tab, setTab] = useState<Tab>("image");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(2);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  const multi = tab === "image" || tab === "video" || tab === "music";

  // Robust download: fetch the asset as a blob and save it (forces a real download,
  // works for cross-origin URLs and data URLs). Falls back to opening in a new tab.
  async function download(url: string, filename: string) {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      window.open(url, "_blank");
    }
  }

  async function pollJob(submit: () => Promise<any>, poll: (id: string) => Promise<any>) {
    const job = await submit();
    let cur = job;
    for (let i = 0; i < 30 && (cur.status === "queued" || cur.status === "running"); i++) {
      await new Promise((r) => setTimeout(r, 1500));
      cur = await poll(job.id);
    }
    return cur;
  }

  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      if (tab === "image") {
        setResult(await api.image({ prompt, n: count }));
      } else if (tab === "code") {
        setResult(await api.code({ prompt, language: "python", mode: "generate" }));
      } else if (tab === "agent") {
        setResult(await api.agentRun({ goal: prompt }));
      } else if (tab === "video") {
        // Generate `count` distinct versions in parallel (each with its own variant).
        const videos = await Promise.all(
          Array.from({ length: count }, (_, i) => pollJob(() => api.videoSubmit({ prompt, variant: i }), api.videoPoll)),
        );
        setResult({ videos });
      } else if (tab === "music") {
        const musics = await Promise.all(
          Array.from({ length: count }, (_, i) => pollJob(() => api.musicSubmit({ prompt, variant: i }), api.musicPoll)),
        );
        setResult({ musics });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Creative Studio</h1>
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button key={t} onClick={() => { setTab(t); setResult(null); }}
            className={`rounded-lg px-3 py-1 capitalize ${tab === t ? "bg-brand" : "bg-zinc-800"}`}>{t}</button>
        ))}
      </div>

      <div className="card space-y-3">
        <textarea className="input h-24" placeholder={`Describe el/la ${tab} que quieres…`}
          value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        {multi && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-zinc-400">¿Cuántas versiones distintas?</span>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className={`h-9 w-9 rounded-lg border text-sm ${count === n ? "border-cyan-400 bg-cyan-400/20 text-white" : "border-white/15 text-zinc-300"}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        <button className="btn" onClick={run} disabled={busy || !prompt}>
          {busy ? "Generando…" : multi ? `Generar ${count} ${tab}(s)` : `Generar ${tab}`}
        </button>
        {multi && <p className="text-xs text-zinc-500">Cada versión es diferente para que elijas la mejor.</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>

      {result && (
        <div className="card mt-4">
          {tab === "image" && (
            <div className="grid grid-cols-2 gap-3">
              {(result.images || []).map((src: string, i: number) => (
                <div key={i} className="flex flex-col gap-2">
                  <img src={src} alt="" className="rounded-lg border border-white/10" />
                  <button className="btn !py-1.5 text-sm" onClick={() => download(src, `mata-imagen-${i + 1}.jpg`)}>
                    ⬇ Descargar imagen {i + 1}
                  </button>
                </div>
              ))}
            </div>
          )}
          {tab === "code" && <pre className="overflow-x-auto text-sm">{result.code}</pre>}
          {tab === "agent" && (
            <div>
              <p className="font-semibold">Answer</p>
              <p className="mb-3 text-zinc-300">{result.final_answer}</p>
            </div>
          )}
          {tab === "video" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(result.videos || []).map((v: any, i: number) => (
                <div key={i} className="rounded-xl border border-white/10 p-3">
                  <p className="mb-2 font-display text-sm text-cyan-300">Versión {i + 1}</p>
                  {v.result_url && String(v.result_url).startsWith("http") ? (
                    <>
                      <video src={v.result_url} controls className="w-full rounded-lg border border-white/10" />
                      <button className="btn mt-2 !py-1.5 text-sm" onClick={() => download(v.result_url, `mata-video-${i + 1}.mp4`)}>
                        ⬇ Descargar video {i + 1}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-amber-400">🎬 Demo · estilo: {v.result_data?.estilo}</p>
                      <pre className="mt-2 overflow-x-auto text-xs text-zinc-300">{JSON.stringify(v.result_data, null, 2)}</pre>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          {tab === "music" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {(result.musics || []).map((m: any, i: number) => (
                <div key={i} className="rounded-xl border border-white/10 p-3">
                  <p className="mb-2 font-display text-sm text-cyan-300">Versión {i + 1}</p>
                  {m.result_url && String(m.result_url).startsWith("http") ? (
                    <>
                      <audio src={m.result_url} controls className="w-full" />
                      <button className="btn mt-2 !py-1.5 text-sm" onClick={() => download(m.result_url, `mata-musica-${i + 1}.mp3`)}>
                        ⬇ Descargar audio {i + 1}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-amber-400">
                        🎵 Demo · {m.result_data?.bpm} BPM · {m.result_data?.tonalidad}
                      </p>
                      <pre className="mt-2 overflow-x-auto text-xs text-zinc-300">{JSON.stringify(m.result_data, null, 2)}</pre>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
