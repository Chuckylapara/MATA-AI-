"use client";
import { useEffect, useMemo, useState } from "react";
import { gallery, GalleryImage } from "@/services/storage";
import { downloadFile } from "@/services/files";

type Filter = "all" | "today" | "7d" | "30d";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "today", label: "Hoy" },
  { key: "7d", label: "7 días" },
  { key: "30d", label: "30 días" },
];

export default function GalleryPage() {
  const [items, setItems] = useState<GalleryImage[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    setItems(gallery.list());
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();
    const day = 86400000;
    return items.filter((it) => {
      if (filter === "all") return true;
      if (filter === "today") return now - it.createdAt < day;
      if (filter === "7d") return now - it.createdAt < 7 * day;
      if (filter === "30d") return now - it.createdAt < 30 * day;
      return true;
    });
  }, [items, filter]);

  function remove(id: string) {
    gallery.remove(id);
    setItems(gallery.list());
  }

  function clearAll() {
    if (confirm("¿Borrar todas las imágenes guardadas?")) {
      gallery.clear();
      setItems([]);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-bold neon-text">Mis Imágenes</h1>
        {items.length > 0 && (
          <button className="rounded-lg border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10" onClick={clearAll}>
            Vaciar galería
          </button>
        )}
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${filter === f.key ? "border-cyan-400 bg-cyan-400/20 text-white" : "border-white/15 text-zinc-300"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card flex flex-col items-center py-16 text-center text-zinc-400">
          <div className="mb-3 text-5xl">🖼️</div>
          <p>No hay imágenes {filter !== "all" ? "en este periodo" : "todavía"}.</p>
          <a href="/studio?tab=image" className="btn mt-4">✨ Crear imágenes</a>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((img) => (
            <div key={img.id} className="card reveal-in group overflow-hidden !p-0">
              <div className="relative">
                <img src={img.url} alt={img.prompt} className="aspect-square w-full object-cover" loading="lazy" />
                <div className="absolute inset-x-0 bottom-0 flex gap-2 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition group-hover:opacity-100">
                  <button
                    className="flex-1 rounded-lg bg-brand/90 py-1.5 text-xs font-medium hover:bg-brand"
                    onClick={() => downloadFile(img.url, `mata-${img.id}.jpg`)}
                  >
                    ⬇ Descargar
                  </button>
                  <button
                    className="rounded-lg bg-red-600/90 px-3 py-1.5 text-xs hover:bg-red-600"
                    onClick={() => remove(img.id)}
                  >
                    🗑
                  </button>
                </div>
              </div>
              <p className="truncate p-2 text-xs text-zinc-400" title={img.prompt}>
                {new Date(img.createdAt).toLocaleDateString()} · {img.prompt}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
