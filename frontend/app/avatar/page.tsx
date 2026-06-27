"use client";
import { useEffect, useRef, useState } from "react";
import { streamChat } from "@/lib/api";
import { MATA_PERSONA, SEARCH_RULE } from "@/services/persona";
import { browserLang, detectLang, GREETINGS, Lang, speechLocale } from "@/services/lang";

const BASE_PERSONA = `${MATA_PERSONA} ${SEARCH_RULE}`;

// Emotion / talk modes — change BOTH the wording style and the voice.
const MOODS: Record<string, { label: string; emoji: string; style: string; rate: number; pitch: number }> = {
  humano: { label: "Humano", emoji: "🙂", style: "Habla relajada y natural, como una amiga de confianza.", rate: 1.0, pitch: 1.0 },
  feliz: { label: "Feliz", emoji: "😄", style: "Habla con mucha energía, alegre y entusiasta, transmite optimismo y buen humor.", rate: 1.12, pitch: 1.2 },
  serio: { label: "Serio", emoji: "🧐", style: "Habla calmada, profesional y concisa, con tono formal y seguro.", rate: 0.93, pitch: 0.85 },
  creativo: { label: "Creativo", emoji: "🎨", style: "Habla imaginativa, juguetona y expresiva, con metáforas y un toque artístico.", rate: 1.04, pitch: 1.08 },
};

type Turn = { role: "user" | "assistant"; text: string };
const URL_RE = /(https?:\/\/[^\s)]+)/g;

function stripForSpeech(text: string): string {
  return text
    .replace(URL_RE, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((p, i) =>
        URL_RE.test(p) ? (
          <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all text-cyan-300 underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export default function AvatarPage() {
  const [supported, setSupported] = useState(true);
  const [conversing, setConversing] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [interim, setInterim] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState("Pulsa una vez y conversa con Mata, como en una llamada");
  const [typed, setTyped] = useState("");
  const [mood, setMood] = useState("humano");

  const recognitionRef = useRef<any>(null);
  const convoRef = useRef<{ role: string; content: string }[]>([]); // user/assistant only
  const convIdRef = useRef<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const conversingRef = useRef(false);
  const speakingRef = useRef(false);
  const spokenTextRef = useRef("");
  const moodRef = useRef("humano");
  const utterCountRef = useRef(0);
  const langRef = useRef<Lang>("es"); // current conversation language (auto-detected)

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  useEffect(() => {
    langRef.current = browserLang();
  }, []);

  // Best available voice for a given language.
  function pickVoiceFor(lang: Lang): SpeechSynthesisVoice | null {
    const list = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const m = list.filter((v) => v.lang.toLowerCase().startsWith(lang));
    return (
      m.find((v) => /natural|neural/i.test(v.name)) ||
      m.find((v) => /google/i.test(v.name)) ||
      m[0] ||
      list[0] ||
      null
    );
  }

  useEffect(() => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR || typeof window.speechSynthesis === "undefined") {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = speechLocale(langRef.current);
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      setInterim(interimText);
      const phrase = finalText.trim();
      if (!phrase || phrase.length < 2) return;

      if (speakingRef.current) {
        const spoken = spokenTextRef.current.toLowerCase();
        if (spoken && spoken.includes(phrase.toLowerCase())) {
          setInterim("");
          return;
        }
        stopSpeaking(); // real interruption
      }
      setInterim("");
      handleUtterance(phrase);
    };
    rec.onend = () => {
      setListening(false);
      if (conversingRef.current) setTimeout(() => startListening(), 300);
    };
    rec.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        setStatus("Necesito permiso del micrófono. Actívalo y vuelve a empezar.");
        stopConversation();
      }
    };
    recognitionRef.current = rec;

    const loadVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices();
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      conversingRef.current = false;
      try { rec.abort(); } catch {}
      window.speechSynthesis.cancel();
    };
  }, []);

  function startListening() {
    const rec = recognitionRef.current;
    if (!rec || !conversingRef.current) return;
    try {
      rec.lang = speechLocale(langRef.current); // follow the detected language
      rec.start();
      setListening(true);
    } catch {
      /* already running */
    }
  }

  function stopSpeaking() {
    window.speechSynthesis.cancel();
    utterCountRef.current = 0;
    setSpeaking(false);
    speakingRef.current = false;
  }

  // Queue a sentence to be spoken (browser plays them in order) with the mood's voice.
  function enqueueSpeak(sentence: string) {
    const clean = stripForSpeech(sentence);
    if (!clean) return;
    spokenTextRef.current += " " + clean.toLowerCase();
    const m = MOODS[moodRef.current];
    const u = new SpeechSynthesisUtterance(clean);
    const v = pickVoiceFor(langRef.current);
    if (v) u.voice = v;
    u.lang = speechLocale(langRef.current);
    u.rate = m.rate;
    u.pitch = m.pitch;
    u.onstart = () => {
      setSpeaking(true);
      speakingRef.current = true;
      setStatus("Mata está hablando… (interrúmpela cuando quieras)");
    };
    u.onend = () => {
      utterCountRef.current = Math.max(0, utterCountRef.current - 1);
      if (utterCountRef.current === 0) {
        setSpeaking(false);
        speakingRef.current = false;
        setStatus("Te escucho…");
      }
    };
    utterCountRef.current += 1;
    window.speechSynthesis.speak(u); // queues after current
  }

  function systemMessage() {
    return { role: "system", content: `${BASE_PERSONA} Estado de ánimo actual: ${MOODS[moodRef.current].style}` };
  }

  async function handleUtterance(text: string) {
    // Auto-detect the user's language → drives the reply language, voice and recognition.
    langRef.current = detectLang(text, langRef.current);
    setTurns((t) => [...t, { role: "user", text }]);
    convoRef.current.push({ role: "user", content: text });
    setThinking(true);
    setStatus("Pensando…");

    // Reset speech state for the new answer.
    stopSpeaking();
    spokenTextRef.current = "";

    setTurns((t) => [...t, { role: "assistant", text: "" }]);

    let full = "";
    let pending = ""; // not-yet-spoken buffer; flushed sentence by sentence (real-time voice)
    try {
      const messages = [systemMessage(), ...convoRef.current];
      convIdRef.current = await streamChat(messages, convIdRef.current, (delta) => {
        if (thinking) setThinking(false);
        full += delta;
        pending += delta;
        setTurns((t) => {
          const c = [...t];
          c[c.length - 1] = { role: "assistant", text: full };
          return c;
        });
        // Speak each complete sentence as soon as it's ready.
        let mm: RegExpMatchArray | null;
        while ((mm = pending.match(/(.+?[.!?…\n])(\s|$)/s))) {
          enqueueSpeak(mm[1]);
          pending = pending.slice((mm.index ?? 0) + mm[0].length);
        }
      });
      if (pending.trim()) enqueueSpeak(pending);
      convoRef.current.push({ role: "assistant", content: full });
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setThinking(false);
    }
  }

  function startConversation() {
    window.speechSynthesis.cancel();
    conversingRef.current = true;
    setConversing(true);
    setTurns([]);
    convoRef.current = [];
    convIdRef.current = null;
    spokenTextRef.current = "";
    langRef.current = browserLang();
    startListening();
    const greeting = GREETINGS[langRef.current];
    setTurns([{ role: "assistant", text: greeting }]);
    enqueueSpeak(greeting);
  }

  function stopConversation() {
    conversingRef.current = false;
    setConversing(false);
    setListening(false);
    setThinking(false);
    stopSpeaking();
    try { recognitionRef.current?.abort(); } catch {}
    setStatus("Conversación terminada. Pulsa para hablar otra vez.");
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim()) return;
    if (speakingRef.current) stopSpeaking();
    handleUtterance(typed.trim());
    setTyped("");
  }

  const moodView = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";

  return (
    <div className="flex flex-col items-center">
      <style>{robotCss}</style>
      <h1 className="mb-1 text-2xl font-bold">Mata · Asistente en vivo</h1>
      <p className="mb-4 text-center text-sm text-zinc-400">
        Voz en tiempo real · respuestas humanas · interrúmpela cuando quieras · pídele que te busque cosas.
      </p>

      {/* Emotion / talk mode selector */}
      <div className="mb-5 flex flex-wrap justify-center gap-2">
        {Object.entries(MOODS).map(([key, m]) => (
          <button
            key={key}
            onClick={() => setMood(key)}
            className={`rounded-full border px-3 py-1 text-sm transition ${mood === key ? "border-cyan-400 bg-cyan-400/20 text-white" : "border-white/15 text-zinc-300"}`}
          >
            {m.emoji} {m.label}
          </button>
        ))}
      </div>

      <div className={`robot ${moodView}`}>
        <div className="halo" />
        <div className="ring r1" />
        <div className="ring r2" />
        <div className="head">
          <div className="antenna" />
          <div className="core" />
          <div className="visor">
            <span className="eye" />
            <span className="eye" />
          </div>
          <div className="bars">
            <span /><span /><span /><span /><span />
          </div>
        </div>
      </div>

      <p className="mt-5 h-6 text-zinc-300">{interim ? <em>“{interim}”</em> : status}</p>

      {!conversing ? (
        <button onClick={startConversation} disabled={!supported} className="btn mt-3">🎤 Empezar a conversar</button>
      ) : (
        <button onClick={stopConversation} className="btn mt-3 !bg-red-600">■ Terminar conversación</button>
      )}

      {conversing && <p className="mt-2 text-xs text-emerald-400">● En vivo — habla cuando quieras, incluso mientras ella habla</p>}
      <p className="mt-1 text-xs text-zinc-500">💡 Usa audífonos para interrumpir mejor (evita el eco del altavoz).</p>

      {!supported && (
        <p className="mt-3 max-w-md text-center text-sm text-amber-400">
          Tu navegador no soporta voz. Usa <b>Chrome</b> o <b>Edge</b>. Puedes escribir abajo.
        </p>
      )}

      <form onSubmit={sendTyped} className="mt-4 flex w-full max-w-md gap-2">
        <input className="input" placeholder="…o escríbeme aquí" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn" type="submit">Enviar</button>
      </form>

      <div className="mt-6 w-full max-w-md space-y-2">
        {turns.slice(-10).map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : ""}>
            <span className={`inline-block max-w-[88%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "bg-brand" : "bg-zinc-800"}`}>
              {t.role === "assistant" ? <Linkified text={t.text} /> : t.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const robotCss = `
.robot { position: relative; width: 280px; height: 280px; display: flex; align-items: center; justify-content: center; perspective: 900px; }
.halo { position: absolute; inset: 10px; border-radius: 50%; background: radial-gradient(circle, rgba(109,40,217,.45), transparent 70%); opacity:.35; transition: opacity .3s, background .3s; }
.robot.listening .halo { opacity:.9; background: radial-gradient(circle, rgba(34,211,238,.5), transparent 70%); animation: pulse 1.2s infinite; }
.robot.thinking .halo { opacity:.7; background: radial-gradient(circle, rgba(234,179,8,.45), transparent 70%); animation: pulse 1.8s infinite; }
.robot.speaking .halo { opacity:.95; background: radial-gradient(circle, rgba(16,185,129,.5), transparent 70%); }
@keyframes pulse { 0%,100% { transform: scale(.92);} 50% { transform: scale(1.06);} }
.ring { position:absolute; border-radius:50%; border:1.5px solid rgba(34,211,238,.35); }
.ring.r1 { inset:0; border-style:dashed; animation: spin 14s linear infinite; }
.ring.r2 { inset:26px; border-color:rgba(168,85,247,.4); animation: spin 9s linear infinite reverse; }
.robot.listening .ring { border-color:rgba(34,211,238,.7); }
.robot.speaking .ring { border-color:rgba(16,185,129,.6); }
.robot.thinking .ring.r1 { animation-duration: 4s; }
@keyframes spin { to { transform: rotate(360deg);} }
.head { position: relative; width: 168px; height: 158px; border-radius: 34px; background: linear-gradient(155deg, rgba(80,70,130,.85), rgba(20,18,40,.95)); border: 1.5px solid rgba(168,85,247,.7); box-shadow: 0 18px 50px rgba(0,0,0,.55), inset 0 2px 14px rgba(168,85,247,.35), inset 0 -10px 30px rgba(0,0,0,.5); transform-style: preserve-3d; animation: headFloat 6s ease-in-out infinite; backdrop-filter: blur(4px); }
@keyframes headFloat { 0%,100% { transform: rotateX(8deg) rotateY(-10deg) translateY(0);} 50% { transform: rotateX(8deg) rotateY(10deg) translateY(-8px);} }
.antenna { position:absolute; top:-22px; left:50%; transform:translateX(-50%); width:4px; height:22px; background:linear-gradient(#a78bfa,#6d28d9); border-radius:3px; }
.antenna::after { content:""; position:absolute; top:-10px; left:50%; transform:translateX(-50%); width:14px; height:14px; border-radius:50%; background:#67e8f9; box-shadow:0 0 16px #22d3ee; animation: pulse 2s infinite; }
.core { position:absolute; top:16px; left:50%; transform:translateX(-50%); width:16px; height:16px; border-radius:50%; background: radial-gradient(circle at 30% 30%, #fff, #22d3ee 60%, #6d28d9); box-shadow:0 0 18px #22d3ee; animation: pulse 2.4s infinite; }
.robot.speaking .core { background: radial-gradient(circle at 30% 30%, #fff, #34d399 60%, #059669); box-shadow:0 0 18px #34d399; }
.visor { position:absolute; top:44px; left:50%; transform:translateX(-50%); width:128px; height:50px; border-radius:26px; background: linear-gradient(180deg, rgba(0,0,0,.7), rgba(10,10,30,.9)); border:1px solid rgba(34,211,238,.4); display:flex; align-items:center; justify-content:center; gap:30px; box-shadow: inset 0 0 18px rgba(34,211,238,.25); }
.eye { width:24px; height:24px; border-radius:50%; background:#67e8f9; box-shadow:0 0 18px #22d3ee, inset 0 0 6px #fff; animation: blink 4.5s infinite; }
.robot.listening .eye { background:#c4b5fd; box-shadow:0 0 20px #a78bfa, inset 0 0 6px #fff; }
.robot.thinking .eye { background:#fde68a; box-shadow:0 0 18px #f59e0b; animation: blink 1s infinite; }
.robot.speaking .eye { background:#6ee7b7; box-shadow:0 0 20px #10b981, inset 0 0 6px #fff; }
@keyframes blink { 0%,92%,100% { transform: scaleY(1);} 96% { transform: scaleY(.08);} }
.bars { position:absolute; bottom:20px; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:6px; height:26px; }
.bars span { width:6px; height:6px; border-radius:3px; background:#67e8f9; box-shadow:0 0 8px #22d3ee; transition:height .12s; }
.robot.speaking .bars span { background:#34d399; box-shadow:0 0 10px #10b981; animation: eq .5s ease-in-out infinite; }
.robot.speaking .bars span:nth-child(1){ animation-delay:0s;}
.robot.speaking .bars span:nth-child(2){ animation-delay:.12s;}
.robot.speaking .bars span:nth-child(3){ animation-delay:.06s;}
.robot.speaking .bars span:nth-child(4){ animation-delay:.18s;}
.robot.speaking .bars span:nth-child(5){ animation-delay:.09s;}
@keyframes eq { 0%,100% { height:6px;} 50% { height:24px;} }
`;
