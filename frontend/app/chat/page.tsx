"use client";
import { useEffect, useRef, useState } from "react";
import { api, getToken, streamChat } from "@/lib/api";
import Thinking from "@/components/Thinking";
import { systemMessage } from "@/services/persona";
import { autoExtractMemory, captureFromText, memory, memoryPrompt, slidingWindow } from "@/services/memory";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; content: string };
type Convo = { id: string; title: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [loggedIn, setLoggedIn] = useState(false);
  const [memories, setMemories] = useState<string[]>([]);
  const [showSidebar, setShowSidebar] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(false);
  const convId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadConvos() {
    if (!getToken()) return;
    try { setConvos(await api.listConversations()); } catch {}
  }

  useEffect(() => {
    setLoggedIn(!!getToken());
    loadConvos();
    setMemories(memory.list());
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function forgetMemory(i: number) {
    memory.remove(i); setMemories(memory.list());
  }

  async function openConversation(id: string) {
    try {
      const data = await api.getConversation(id);
      setMessages(data.messages.map((m: any) => ({ role: m.role, content: m.content })));
      convId.current = id; setShowSidebar(false);
    } catch {}
  }

  function newChat() {
    setMessages([]); convId.current = null; setGuestPrompt(false); setShowSidebar(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function stop() { abortRef.current?.abort(); }

  async function send() {
    if (!input.trim() || busy) return;
    const userText = input;
    const captured = captureFromText(userText);
    if (captured) setMemories(memory.list());
    const history = [...messages, { role: "user" as const, content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput(""); setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const sys = systemMessage(memoryPrompt());
      const payload = [sys, ...slidingWindow(history, 24)];
      const newConv = await streamChat(payload as any, convId.current,
        (delta) => setMessages(cur => {
          const c = [...cur]; c[c.length - 1] = { role: "assistant", content: c[c.length - 1].content + delta }; return c;
        }), controller.signal);
      convId.current = newConv;
      loadConvos();
      if (!captured) autoExtractMemory(userText).then(added => { if (added.length) setMemories(memory.list()); });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMessages(cur => { const c = [...cur]; if (c.at(-1)?.role === "assistant" && !c.at(-1)?.content) c.pop(); return c; });
      } else if (err?.message === "GUEST_LIMIT") {
        setMessages(cur => cur.slice(0, -1));
        setGuestPrompt(true);
      } else {
        setMessages(cur => [...cur.slice(0, -1), { role: "assistant", content: `⚠️ ${err.message}` }]);
      }
    } finally { setBusy(false); abortRef.current = null; }
  }

  const lastIsEmpty = messages.at(-1)?.role === "assistant" && messages.at(-1)?.content === "";

  const Sidebar = () => (
    <div className="flex flex-col h-full p-3 sm:p-4">
      <button className="btn w-full py-2 text-sm mb-3" onClick={newChat}>＋ Nuevo chat</button>

      <p className="text-[10px] uppercase tracking-widest text-white/35 px-1 mb-2">Historial</p>
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {!loggedIn && (
          <div className="px-2 py-3 text-xs text-white/40 text-center">
            <Link href="/login" className="text-cyan-400 hover:underline">Inicia sesión</Link> para guardar tu historial
          </div>
        )}
        {loggedIn && convos.length === 0 && <p className="px-1 text-xs text-white/35">Sin conversaciones aún.</p>}
        {convos.map(c => (
          <button key={c.id} onClick={() => openConversation(c.id)}
            className={`w-full truncate rounded-xl px-3 py-2 text-left text-xs transition hover:bg-white/8 ${convId.current === c.id ? "bg-white/10 text-white" : "text-white/55"}`}
            title={c.title}>
            💬 {c.title}
          </button>
        ))}
      </div>

      {memories.length > 0 && (
        <div className="border-t border-white/10 mt-3 pt-3">
          <p className="text-[10px] uppercase tracking-widest text-white/35 px-1 mb-2">🧠 Memoria</p>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {memories.map((m, i) => (
              <div key={i} className="group flex items-start gap-1 rounded-lg px-2 py-1 text-xs text-white/45 hover:bg-white/5">
                <span className="flex-1">· {m}</span>
                <button onClick={() => forgetMemory(i)} className="opacity-0 group-hover:opacity-100 transition shrink-0">✕</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="px-3 sm:px-4 lg:px-8 max-w-6xl mx-auto">
      <div className="flex gap-3 sm:gap-4" style={{height: "calc(100vh - 110px)", minHeight: "500px"}}>

        {/* Sidebar — desktop */}
        <aside className="hidden md:flex flex-col w-56 lg:w-64 shrink-0 liquid-glass rounded-2xl overflow-hidden">
          <Sidebar />
        </aside>

        {/* Mobile sidebar overlay */}
        {showSidebar && (
          <div className="fixed inset-0 z-50 md:hidden" onClick={() => setShowSidebar(false)}>
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <div className="absolute top-20 left-3 right-3 bottom-4 liquid-glass-strong rounded-2xl overflow-hidden flex flex-col"
                 onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-sm font-medium text-white">Historial</span>
                <button onClick={() => setShowSidebar(false)} className="text-white/50 hover:text-white text-lg">✕</button>
              </div>
              <div className="flex-1 overflow-hidden"><Sidebar /></div>
            </div>
          </div>
        )}

        {/* Main chat */}
        <div className="flex flex-1 flex-col min-w-0 gap-3">
          {/* Header */}
          <div className="flex items-center gap-3">
            <button onClick={() => setShowSidebar(true)} className="md:hidden btn-glass p-2 rounded-xl text-sm">☰</button>
            <h1 className="font-display font-semibold text-xl sm:text-2xl text-white tracking-tight flex-1">
              Chat con Mata AI
            </h1>
            <button className="btn py-1.5 px-4 text-xs hidden sm:inline-flex" onClick={newChat}>＋ Nuevo</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-2xl liquid-glass p-3 sm:p-4 space-y-3 min-h-0">
            {messages.length === 0 && !guestPrompt && (
              <div className="flex h-full flex-col items-center justify-center text-center py-12">
                <div className="text-5xl mb-4">🧠</div>
                <p className="text-white/50 text-sm max-w-xs">Empieza a conversar con Mata AI. No necesitas cuenta para comenzar.</p>
                {/* Quick prompts */}
                <div className="flex flex-wrap gap-2 justify-center mt-6">
                  {["Hola, ¿qué puedes hacer?", "Cuéntame algo interesante", "Ayúdame a crear algo"].map(p => (
                    <button key={p} onClick={() => { setInput(p); setTimeout(() => inputRef.current?.focus(), 50); }}
                      className="pill text-xs hover:bg-white/15 transition-colors cursor-pointer">{p}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white mr-2 mt-1 shrink-0">M</div>
                )}
                <div className={`max-w-[85%] sm:max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "bubble-user text-white/90" : "bubble-ai text-white/85"
                }`}>
                  {m.content || (lastIsEmpty && i === messages.length - 1 ? <Thinking /> : "…")}
                </div>
              </div>
            ))}

            {/* Guest upgrade prompt */}
            {guestPrompt && (
              <div className="flex justify-center py-4">
                <div className="liquid-glass-strong rounded-2xl p-5 text-center max-w-sm">
                  <div className="text-3xl mb-2">🔓</div>
                  <p className="text-white font-medium text-sm mb-1">Crea una cuenta gratis</p>
                  <p className="text-white/50 text-xs mb-4">Regístrate para seguir chateando. Es gratis, sin tarjeta.</p>
                  <div className="flex gap-2 justify-center">
                    <Link href="/login" className="btn text-xs px-5 py-2">Crear cuenta gratis</Link>
                    <Link href="/billing" className="btn-glass text-xs px-4 py-2">Ver planes</Link>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex gap-2 items-end">
            <input
              ref={inputRef}
              className="input flex-1 text-sm"
              value={input}
              placeholder="Escribe a Mata AI… (sin cuenta para comenzar)"
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && send()}
            />
            {busy
              ? <button className="btn shrink-0 px-4 py-2.5 text-sm" style={{background:"linear-gradient(135deg,#dc2626,#ef4444)"}} onClick={stop}>■</button>
              : <button className="btn shrink-0 px-4 sm:px-6 py-2.5 text-sm" onClick={send}>Enviar</button>
            }
          </div>

          {!loggedIn && !guestPrompt && (
            <p className="text-center text-white/25 text-xs">
              Chatea sin cuenta · <Link href="/login" className="text-cyan-400/70 hover:text-cyan-400">Inicia sesión</Link> para historial y más créditos
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
