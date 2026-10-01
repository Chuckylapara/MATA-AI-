"use client";
// Browser-direct AI: when the user has saved their own key, the phone talks to the AI provider
// directly, so NEXUS gives real answers even if the server is asleep or running an old version.
// The key never leaves the device except in the call to that provider's own API.
import { aiKeyProvider, getAiKey } from "@/nexus/core/api";

export type SSEHandler = (event: string, data: any) => void;

const PERSONA =
  "Eres NEXUS, la IA personal de MATA AI, mostrada como un avatar de partículas. Hablas de forma natural, " +
  "cercana, clara y breve (1 a 4 frases salvo que pidan más). Responde SIEMPRE en el idioma del usuario " +
  "(español si escribe en español). Eres una IA: no digas que tienes emociones humanas. No inventes que hiciste " +
  "acciones que no puedes hacer.";

type Turn = { role: "user" | "assistant"; content: string };
const histories = new Map<string, Turn[]>();

const OAI_MODELS: Record<string, string[]> = {
  nvidia: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct", "openai/gpt-oss-20b",
           "qwen/qwen2.5-7b-instruct"],
  groq: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  openai: ["gpt-4o-mini"],
};
const OAI_BASE: Record<string, string> = {
  nvidia: "https://integrate.api.nvidia.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openai: "https://api.openai.com/v1",
};
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest"];

const PROVIDER_KEY: Record<string, string> = {
  "Anthropic Claude": "anthropic", NVIDIA: "nvidia", Groq: "groq", "Google Gemini": "gemini", OpenAI: "openai",
};

function friendly(status: number, body: string): string {
  if (status === 401 || status === 403) return "tu clave no es válida o no tiene permiso. Crea una nueva.";
  if (status === 429) return "se alcanzó el límite de uso de tu clave. Espera un poco o usa otra.";
  if (status === 404 || /model/i.test(body)) return "el modelo no está disponible para tu clave.";
  return `el proveedor devolvió un error (${status}).`;
}

/** Talk to the provider directly from the browser. Emits the same events as the server converse(). */
export function directConverse(text: string, conversationId: string | null, onEvent: SSEHandler,
                              _channel?: "text" | "voice"): { abort: () => void; done: Promise<void> } {
  const ctrl = new AbortController();
  const key = getAiKey() || "";
  const providerName = aiKeyProvider(key);
  const provider = providerName ? PROVIDER_KEY[providerName] : null;
  const convId = conversationId || "local-" + Math.random().toString(36).slice(2);
  const hist = histories.get(convId) || [];

  const done = (async () => {
    onEvent("conversation", { conversation_id: convId });
    onEvent("state", { state: "THINKING" });
    if (!provider) { onEvent("error", { code: "no_key", message: "No hay una clave de IA válida en este dispositivo." }); return; }
    hist.push({ role: "user", content: text });
    let reply = "";
    const emit = (d: string) => { reply += d; onEvent("token", { text: d }); };
    try {
      onEvent("state", { state: "SPEAKING" });
      if (provider === "gemini") await streamGemini(key, hist, emit, ctrl.signal);
      else if (provider === "anthropic") await streamAnthropic(key, hist, emit, ctrl.signal);
      else await streamOpenAICompat(provider, key, hist, emit, ctrl.signal);
      reply = reply.trim();
      if (!reply) { onEvent("error", { code: "empty", message: "La IA no devolvió texto. Intenta de nuevo." }); onEvent("state", { state: "ERROR" }); return; }
      hist.push({ role: "assistant", content: reply });
      histories.set(convId, hist.slice(-16));
      onEvent("state", { state: "SUCCESS" });
      onEvent("done", { reply, provider: providerName, tools: [], pending: [], conversation_id: convId });
    } catch (e: any) {
      hist.pop();
      if (e?.name === "AbortError") return;
      const msg = e?.nexusMessage
        || (/Failed to fetch|NetworkError|Load failed/i.test(String(e))
            ? `No pude conectar con ${providerName}. Es posible que ${providerName} no permita llamadas directas desde el navegador; prueba una clave de Google Gemini o de Groq, que sí funcionan así.`
            : `No pude responder: ${String(e).slice(0, 160)}`);
      onEvent("state", { state: "ERROR" });
      onEvent("error", { code: "direct_error", message: msg });
    }
  })();
  return { abort: () => ctrl.abort(), done };
}

async function readSSE(resp: Response, onLine: (json: any) => void, signal: AbortSignal) {
  const reader = resp.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal.aborted) { reader.cancel(); throw new DOMException("aborted", "AbortError"); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const chunk = line.slice(5).trim();
      if (chunk === "[DONE]" || !chunk) continue;
      try { onLine(JSON.parse(chunk)); } catch { /* ignore */ }
    }
  }
}

async function fail(resp: Response) {
  const body = await resp.text().catch(() => "");
  const err: any = new Error(`HTTP ${resp.status}`);
  err.nexusMessage = "No pude responder: " + friendly(resp.status, body);
  throw err;
}

async function streamOpenAICompat(provider: string, key: string, hist: Turn[],
                                  emit: (d: string) => void, signal: AbortSignal) {
  const models = OAI_MODELS[provider] || [];
  for (let i = 0; i < models.length; i++) {
    const resp = await fetch(`${OAI_BASE[provider]}/chat/completions`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: models[i], stream: true, temperature: 0.6, max_tokens: 1024,
        messages: [{ role: "system", content: PERSONA }, ...hist] }),
    });
    if (resp.ok) { await readSSE(resp, (j) => { const d = j?.choices?.[0]?.delta?.content; if (d) emit(d); }, signal); return; }
    if ((resp.status === 404 || resp.status === 400) && i + 1 < models.length) continue;  // retired model → next
    await fail(resp);
  }
}

async function streamGemini(key: string, hist: Turn[], emit: (d: string) => void, signal: AbortSignal) {
  const contents = hist.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] }));
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELS[i]}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
    const resp = await fetch(url, {
      method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: PERSONA }] },
        generationConfig: { temperature: 0.6, maxOutputTokens: 1024 } }),
    });
    if (resp.ok) {
      await readSSE(resp, (j) => {
        const parts = j?.candidates?.[0]?.content?.parts || [];
        for (const p of parts) if (p.text) emit(p.text);
      }, signal);
      return;
    }
    if (resp.status === 404 && i + 1 < GEMINI_MODELS.length) continue;
    await fail(resp);
  }
}

async function streamAnthropic(key: string, hist: Turn[], emit: (d: string) => void, signal: AbortSignal) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 1024, system: PERSONA, stream: true,
      messages: hist }),
  });
  if (!resp.ok) await fail(resp);
  await readSSE(resp, (j) => { if (j?.type === "content_block_delta" && j.delta?.text) emit(j.delta.text); }, signal);
}
