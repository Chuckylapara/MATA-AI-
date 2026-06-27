"use client";

import { api } from "@/lib/api";

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

// --- Automatic memory extraction ---
// Runs in the background after a turn. Asks the model to pull durable personal facts
// from the user's message and stores them. Returns the newly added facts.
const EXTRACT_SYS =
  "Eres un extractor de memoria. Del mensaje del usuario extrae SOLO datos personales duraderos que valga la pena " +
  "recordar a largo plazo (nombre, ciudad/país, trabajo o estudios, gustos y preferencias, objetivos, relaciones, " +
  "fechas importantes). NO incluyas preguntas, peticiones momentáneas, ni cosas triviales o de un solo uso. " +
  "Responde EXCLUSIVAMENTE con un array JSON de cadenas cortas (máx 8 palabras c/u), en el idioma del usuario. " +
  'Si no hay nada que recordar, responde []. Ejemplo: ["Se llama Drew","Vive en Madrid","Le gusta el café"].';

export async function autoExtractMemory(userText: string): Promise<string[]> {
  if (!userText || userText.trim().length < 8) return [];
  try {
    const res = await api.chat([
      { role: "system", content: EXTRACT_SYS },
      { role: "user", content: userText },
    ]);
    const txt = (res?.content || "").trim();
    const match = txt.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    const added: string[] = [];
    for (const item of arr) {
      if (typeof item === "string" && item.trim() && memory.add(item)) added.push(item);
    }
    return added;
  } catch {
    return [];
  }
}
