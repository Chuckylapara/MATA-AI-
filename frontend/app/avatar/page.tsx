"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// Mata's personality — answers like a real, warm human in spoken Spanish.
const PERSONA = {
  role: "system",
  content:
    "Eres Mata, una asistente conversacional con personalidad cálida, cercana y natural. " +
    "Hablas en español como una persona real en una charla hablada: respuestas breves (1 a 3 frases), " +
    "tono amable, espontáneo y humano. Usas expresiones naturales ('claro', 'mira', 'la verdad es que'). " +
    "Nunca digas que eres una IA ni un modelo; responde como una persona. Evita listas y respuestas largas o robóticas. " +
    "Si te preguntan tu nombre, eres Mata. Sé empática y haz que la conversación fluya.",
};

type Turn = { role: "user" | "assistant"; text: string };

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

  const recognitionRef = useRef<any>(null);
  const historyRef = useRef<any[]>([PERSONA]);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Refs mirror state so async callbacks read fresh values (avoid stale closures).
  const conversingRef = useRef(false);
  const busyRef = useRef(false); // thinking or speaking → don't auto-listen

  // --- Set up speech recognition + pick a Spanish voice ---
  useEffect(() => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR || typeof window.speechSynthesis === "undefined") {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.lang = "es-ES";
    rec.continuous = false;
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
      if (finalText.trim()) {
        setInterim("");
        busyRef.current = true; // block auto-restart until Mata answers
        handleUtterance(finalText.trim());
      }
    };

    rec.onend = () => {
      setListening(false);
      // In conversation mode, if we're idle (no answer in progress), keep listening.
      if (conversingRef.current && !busyRef.current) {
        setTimeout(() => startListening(), 350);
      }
    };

    rec.onerror = (e: any) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setStatus("Necesito permiso del micrófono. Actívalo y vuelve a empezar.");
        stopConversation();
      } else if (conversingRef.current && !busyRef.current) {
        // 'no-speech' / 'aborted' → just keep listening.
        setTimeout(() => startListening(), 400);
      }
    };

    recognitionRef.current = rec;

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((v) => v.lang.startsWith("es") && /female|mujer|mónica|paulina|helena|sabina|google/i.test(v.name)) ||
        voices.find((v) => v.lang.startsWith("es")) ||
        voices[0] ||
        null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;

    return () => {
      conversingRef.current = false;
      try { rec.abort(); } catch {}
      window.speechSynthesis.cancel();
    };
  }, []);

  function startListening() {
    const rec = recognitionRef.current;
    if (!rec || !conversingRef.current || busyRef.current) return;
    try {
      rec.start();
      setListening(true);
      setStatus("Te escucho… habla");
    } catch {
      /* already running */
    }
  }

  function speak(text: string) {
    const u = new SpeechSynthesisUtterance(text);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.lang = "es-ES";
    u.rate = 1.03;
    u.pitch = 1.05;
    u.onstart = () => {
      setSpeaking(true);
      setStatus("Mata está hablando…");
    };
    u.onend = () => {
      setSpeaking(false);
      busyRef.current = false;
      // Conversation continues: go back to listening automatically.
      if (conversingRef.current) startListening();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  async function handleUtterance(text: string) {
    setTurns((t) => [...t, { role: "user", text }]);
    historyRef.current.push({ role: "user", content: text });
    setThinking(true);
    setStatus("Pensando…");
    try {
      const res = await api.chat(historyRef.current.slice(-14));
      const reply = (res.content || "").trim() || "Perdona, ¿me lo repites?";
      historyRef.current.push({ role: "assistant", content: reply });
      setTurns((t) => [...t, { role: "assistant", text: reply }]);
      setThinking(false);
      speak(reply); // speaking → onend resumes listening
    } catch (err: any) {
      setThinking(false);
      busyRef.current = false;
      setStatus(`Error: ${err.message}`);
      if (conversingRef.current) startListening();
    }
  }

  function startConversation() {
    window.speechSynthesis.cancel();
    conversingRef.current = true;
    busyRef.current = false;
    setConversing(true);
    // A tiny silent utterance "unlocks" speech synthesis on some browsers.
    startListening();
  }

  function stopConversation() {
    conversingRef.current = false;
    busyRef.current = false;
    setConversing(false);
    setListening(false);
    setThinking(false);
    setSpeaking(false);
    try { recognitionRef.current?.abort(); } catch {}
    window.speechSynthesis.cancel();
    setStatus("Conversación terminada. Pulsa para hablar otra vez.");
  }

  function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    if (!typed.trim() || busyRef.current) return;
    busyRef.current = true;
    handleUtterance(typed.trim());
    setTyped("");
  }

  const mood = speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";

  return (
    <div className="flex flex-col items-center">
      <style>{robotCss}</style>
      <h1 className="mb-1 text-2xl font-bold">Mata · Asistente en vivo</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Pulsa <b>una sola vez</b> y conversa sin tocar nada más, como hablar con una persona.
      </p>

      {/* Robot avatar */}
      <div className={`robot ${mood}`}>
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
        <button onClick={startConversation} disabled={!supported} className="btn mt-3">
          🎤 Empezar a conversar
        </button>
      ) : (
        <button onClick={stopConversation} className="btn mt-3 !bg-red-600">
          ■ Terminar conversación
        </button>
      )}

      {conversing && (
        <p className="mt-2 text-xs text-emerald-400">● En vivo — habla cuando quieras, Mata te responde sola</p>
      )}

      {!supported && (
        <p className="mt-3 max-w-md text-center text-sm text-amber-400">
          Tu navegador no soporta voz. Usa <b>Chrome</b> o <b>Edge</b>. Mientras tanto puedes escribir abajo.
        </p>
      )}

      {/* Typed fallback */}
      <form onSubmit={sendTyped} className="mt-4 flex w-full max-w-md gap-2">
        <input className="input" placeholder="…o escríbeme aquí" value={typed} onChange={(e) => setTyped(e.target.value)} />
        <button className="btn" type="submit">Enviar</button>
      </form>

      {/* Conversation log */}
      <div className="mt-6 w-full max-w-md space-y-2">
        {turns.slice(-8).map((t, i) => (
          <div key={i} className={t.role === "user" ? "text-right" : ""}>
            <span className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${t.role === "user" ? "bg-brand" : "bg-zinc-800"}`}>
              {t.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const robotCss = `
.robot { position: relative; width: 280px; height: 280px; display: flex; align-items: center; justify-content: center; perspective: 900px; }

/* Glow halo */
.halo { position: absolute; inset: 10px; border-radius: 50%; background: radial-gradient(circle, rgba(109,40,217,.45), transparent 70%); opacity:.35; transition: opacity .3s, background .3s; }
.robot.listening .halo { opacity:.9; background: radial-gradient(circle, rgba(34,211,238,.5), transparent 70%); animation: pulse 1.2s infinite; }
.robot.thinking .halo { opacity:.7; background: radial-gradient(circle, rgba(234,179,8,.45), transparent 70%); animation: pulse 1.8s infinite; }
.robot.speaking .halo { opacity:.95; background: radial-gradient(circle, rgba(16,185,129,.5), transparent 70%); }
@keyframes pulse { 0%,100% { transform: scale(.92);} 50% { transform: scale(1.06);} }

/* Orbiting rings */
.ring { position:absolute; border-radius:50%; border:1.5px solid rgba(34,211,238,.35); }
.ring.r1 { inset:0; border-style:dashed; animation: spin 14s linear infinite; }
.ring.r2 { inset:26px; border-color:rgba(168,85,247,.4); animation: spin 9s linear infinite reverse; }
.robot.listening .ring { border-color:rgba(34,211,238,.7); }
.robot.speaking .ring { border-color:rgba(16,185,129,.6); }
.robot.thinking .ring.r1 { animation-duration: 4s; }
@keyframes spin { to { transform: rotate(360deg);} }

/* Head */
.head {
  position: relative; width: 168px; height: 158px; border-radius: 34px;
  background: linear-gradient(155deg, rgba(80,70,130,.85), rgba(20,18,40,.95));
  border: 1.5px solid rgba(168,85,247,.7);
  box-shadow: 0 18px 50px rgba(0,0,0,.55), inset 0 2px 14px rgba(168,85,247,.35), inset 0 -10px 30px rgba(0,0,0,.5);
  transform-style: preserve-3d;
  animation: headFloat 6s ease-in-out infinite;
  backdrop-filter: blur(4px);
}
@keyframes headFloat {
  0%,100% { transform: rotateX(8deg) rotateY(-10deg) translateY(0);}
  50% { transform: rotateX(8deg) rotateY(10deg) translateY(-8px);}
}

/* Antenna */
.antenna { position:absolute; top:-22px; left:50%; transform:translateX(-50%); width:4px; height:22px; background:linear-gradient(#a78bfa,#6d28d9); border-radius:3px; }
.antenna::after { content:""; position:absolute; top:-10px; left:50%; transform:translateX(-50%); width:14px; height:14px; border-radius:50%; background:#67e8f9; box-shadow:0 0 16px #22d3ee; animation: pulse 2s infinite; }

/* Forehead core gem */
.core { position:absolute; top:16px; left:50%; transform:translateX(-50%); width:16px; height:16px; border-radius:50%;
  background: radial-gradient(circle at 30% 30%, #fff, #22d3ee 60%, #6d28d9);
  box-shadow:0 0 18px #22d3ee; animation: pulse 2.4s infinite; }
.robot.speaking .core { background: radial-gradient(circle at 30% 30%, #fff, #34d399 60%, #059669); box-shadow:0 0 18px #34d399; }

/* Visor with eyes */
.visor {
  position:absolute; top:44px; left:50%; transform:translateX(-50%);
  width:128px; height:50px; border-radius:26px;
  background: linear-gradient(180deg, rgba(0,0,0,.7), rgba(10,10,30,.9));
  border:1px solid rgba(34,211,238,.4); display:flex; align-items:center; justify-content:center; gap:30px;
  box-shadow: inset 0 0 18px rgba(34,211,238,.25);
}
.eye { width:24px; height:24px; border-radius:50%; background:#67e8f9; box-shadow:0 0 18px #22d3ee, inset 0 0 6px #fff; animation: blink 4.5s infinite; }
.robot.listening .eye { background:#c4b5fd; box-shadow:0 0 20px #a78bfa, inset 0 0 6px #fff; }
.robot.thinking .eye { background:#fde68a; box-shadow:0 0 18px #f59e0b; animation: blink 1s infinite; }
.robot.speaking .eye { background:#6ee7b7; box-shadow:0 0 20px #10b981, inset 0 0 6px #fff; }
@keyframes blink { 0%,92%,100% { transform: scaleY(1);} 96% { transform: scaleY(.08);} }

/* Equalizer mouth */
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
