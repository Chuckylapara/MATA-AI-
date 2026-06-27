"use client";

// Local persistent gallery of generated images. Survives backend redeploys and works
// fully client-side. Modular on purpose: swap this implementation for Firestore later
// without touching the UI (same exported API).

export type GalleryImage = {
  id: string;
  url: string;
  prompt: string;
  createdAt: number; // epoch ms
};

const KEY = "mata_gallery_v1";

function read(): GalleryImage[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(items: GalleryImage[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 200))); // cap to avoid bloat
}

export const gallery = {
  add(images: { url: string; prompt: string }[]): GalleryImage[] {
    const now = Date.now();
    const added = images.map((im, i) => ({
      id: `${now}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      url: im.url,
      prompt: im.prompt,
      createdAt: now,
    }));
    write([...added, ...read()]);
    return added;
  },
  list(): GalleryImage[] {
    return read().sort((a, b) => b.createdAt - a.createdAt);
  },
  remove(id: string) {
    write(read().filter((x) => x.id !== id));
  },
  clear() {
    write([]);
  },
};
