"use client";
import { useRef, useState } from "react";
import { streamChat } from "@/lib/api";

type Msg = { role: "user" | "assistant"; content: string };

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const convId = useRef<string | null>(null);

  async function send() {
    if (!input.trim() || busy) return;
    const history = [...messages, { role: "user" as const, content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const newConv = await streamChat(history, convId.current, (delta) => {
        setMessages((cur) => {
          const copy = [...cur];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
          return copy;
        });
      });
      convId.current = newConv;
    } catch (err: any) {
      setMessages((cur) => [...cur.slice(0, -1), { role: "assistant", content: `Error: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[70vh] flex-col">
      <h1 className="mb-4 text-2xl font-bold">Chat Assistant</h1>
      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-zinc-800 p-4">
        {messages.length === 0 && <p className="text-zinc-500">Start a conversation…</p>}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <span className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 ${m.role === "user" ? "bg-brand" : "bg-zinc-800"}`}>
              {m.content || "…"}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input" value={input} placeholder="Message Mata AI…"
          onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button className="btn" onClick={send} disabled={busy}>Send</button>
      </div>
    </div>
  );
}
