"use client";
import { useEffect, useRef, useState } from "react";
import { api, getToken, streamChat } from "@/lib/api";
import Thinking from "@/components/Thinking";

type Msg = { role: "user" | "assistant"; content: string };

// Mata AI personality — conversational, warm, helpful.
const MATA_SYSTEM = {
  role: "system",
  content:
    "Eres Mata AI, una asistente conversacional cálida, natural y muy útil. Hablas en español de forma clara y cercana, " +
    "como una persona real. Eres concisa cuando la pregunta es simple y detallada cuando hace falta. Nunca digas que eres " +
    "un modelo o IA genérica: eres Mata AI. Usas un tono amable y profesional, y das pasos concretos cuando te piden ayuda.",
};

type Convo = { id: string; title: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function loadConvos() {
    try {
      const list = await api.listConversations();
      setConvos(list);
    } catch {
      /* not logged in */
    }
  }

  useEffect(() => {
    setLoggedIn(!!getToken());
    loadConvos();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function openConversation(id: string) {
    try {
      const data = await api.getConversation(id);
      setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      convId.current = id;
    } catch (e: any) {
      /* ignore */
    }
  }

  function newChat() {
    setMessages([]);
    convId.current = null;
  }

  async function send() {
    if (!input.trim() || busy) return;
    const history = [...messages, { role: "user" as const, content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const payload = [MATA_SYSTEM, ...history];
      const newConv = await streamChat(payload as any, convId.current, (delta) => {
        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
          return copy;
        });
      });
      convId.current = newConv;
      loadConvos(); // refresh history sidebar
    } catch (err: any) {
      setMessages((cur) => [...cur.slice(0, -1), { role: "assistant", content: `⚠️ Error: ${err.message}. Intenta de nuevo.` }]);
    } finally {
      setBusy(false);
    }
  }

  const lastIsEmptyAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant" && messages[messages.length - 1].content === "";

  return (
    <div className="flex h-[76vh] gap-4">
      {/* History sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-3 md:flex">
        <button className="btn mb-3 w-full !py-2 text-sm" onClick={newChat}>＋ Nuevo chat</button>
        <p className="mb-2 px-1 text-xs uppercase tracking-widest text-zinc-500">Historial</p>
        <div className="flex-1 space-y-1 overflow-y-auto">
          {!loggedIn && <p className="px-1 text-xs text-zinc-500">Inicia sesión para guardar tu historial.</p>}
          {loggedIn && convos.length === 0 && <p className="px-1 text-xs text-zinc-500">Sin conversaciones aún.</p>}
          {convos.map((c) => (
            <button
              key={c.id}
              onClick={() => openConversation(c.id)}
              className={`w-full truncate rounded-lg px-2 py-2 text-left text-sm transition hover:bg-white/10 ${convId.current === c.id ? "bg-white/10 text-white" : "text-zinc-300"}`}
              title={c.title}
            >
              💬 {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="flex flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold">Chat con Mata AI</h1>
          <button className="btn !px-3 !py-1.5 text-xs md:hidden" onClick={newChat}>＋ Nuevo</button>
        </div>
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center text-zinc-500">
              <div className="mb-2 text-4xl">🧠</div>
              <p>Empieza a conversar con Mata AI…</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <span className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 ${m.role === "user" ? "bg-brand" : "border border-white/10 bg-zinc-800/80"}`}>
                {m.content || (lastIsEmptyAssistant && i === messages.length - 1 ? <Thinking /> : "…")}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="input"
            value={input}
            placeholder="Escribe a Mata AI…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
          />
          <button className="btn" onClick={send} disabled={busy}>{busy ? "…" : "Enviar"}</button>
        </div>
      </div>
    </div>
  );
}
