"use client";

// Long-term memory for Mata AI (persists across sessions, per browser).
// Plus a sliding-window helper so long conversations stay fast and on-topic.
// Modular: swap localStorage for Firestore later without changing callers.

const KEY = "mata_memory_v1";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(items: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, 50))); // cap
}

export const memory = {
  list(): string[] {
    return read();
  },
  add(fact: string): boolean {
    const f = fact.trim().replace(/\s+/g, " ").slice(0, 200);
    if (!f) return false;
    const cur = read();
    if (cur.some((x) => x.toLowerCase() === f.toLowerCase())) return false; // no dup
    write([...cur, f]);
    return true;
  },
  remove(i: number) {
    const cur = read();
    cur.splice(i, 1);
    write(cur);
  },
  clear() {
    write([]);
  },
};

// System-prompt snippet so the model always knows the remembered facts.
export function memoryPrompt(): string {
  const facts = read();
  if (!facts.length) return "";
  return (
    "Datos que el usuario te pidió recordar (tenlos siempre en cuenta y úsalos cuando sea relevante): " +
    facts.map((f) => `- ${f}`).join(" ")
  );
}

// Detect "recuerda que / remember that / rappelle-toi / ricorda / lembre / merke dir …" and capture the fact.
const CAPTURE =
  /\b(?:recu[eé]rda(?:te)?|ten en cuenta|rec[ou]erda|remember|note that|keep in mind|rappelle[- ]toi|souviens[- ]toi|ricorda|tieni a mente|lembre|merke dir|denk daran)\b(?:\s+(?:que|that|che|de|of))?\s*:?\s+(.+)/i;

export function captureFromText(text: string): string | null {
  const m = text.match(CAPTURE);
  if (!m) return null;
  const fact = m[1].trim().replace(/[.?!]+$/, "");
  if (fact.length < 2 || fact.endsWith("?")) return null; // ignore questions
  return memory.add(fact) ? fact : null;
}

// Keep only the last N messages sent to the model (full history still shown in the UI).
export function slidingWindow<T>(messages: T[], max = 24): T[] {
  return messages.length <= max ? messages : messages.slice(messages.length - max);
}
