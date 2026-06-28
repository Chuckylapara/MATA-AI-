"use client";
import { useEffect, useRef, useState } from "react";
import { streamChat, getToken } from "@/lib/api";
import { MATA_PERSONA, SEARCH_RULE } from "@/services/persona";
import { browserLang, detectLang, GREETINGS, Lang, speechLocale } from "@/services/lang";
import { autoExtractMemory, captureFromText, memoryPrompt, slidingWindow } from "@/services/memory";

const BASE_PERSONA = `${MATA_PERSONA} ${SEARCH_RULE}`;
const ANTI_REPEAT =
  "Ya te presentaste al inicio de la sesión: NO vuelvas a saludar, NO digas tu nombre ni 'soy Mata AI' otra vez, " +
  "y NUNCA repitas una respuesta anterior. Cada respuesta debe ser nueva, breve y avanzar la conversación según el contexto.";

const LANG_NAMES: Record<Lang, string> = {
  es: "español", en: "inglés", fr: "francés", it: "italiano", pt: "portugués", de: "alemán",
};
const LANG_OPTS: { key: "auto" | Lang; label: string }[] = [
  { key: "auto", label: "🌐" }, { key: "es", label: "🇪🇸" }, { key: "en", label: "🇬🇧" },
  { key: "fr", label: "🇫🇷" }, { key: "it", label: "🇮🇹" }, { key: "pt", label: "🇵🇹" }, { key: "de", label: "🇩🇪" },
];
const MALE_HINTS = /(pablo|jorge|alvaro|álvaro|raul|raúl|diego|enrique|miguel|carlos|juan|jose|josé|david|mark|guy|christopher|eric|brian|paul|thomas|henri|matteo|giorgio|bruno|hans|male|hombre|masculino)/i;
const FEMALE_HINTS = /(sabina|helena|laura|elena|paulina|monica|mónica|dalia|lucia|lucía|maria|maría|samantha|zira|aria|jenny|female|mujer|woman|google)/i;

const MOODS: Record<string, { label: string; emoji: string; style: string; rate: number; pitch: number }> = {
  humano:   { label: "Humano",   emoji: "🙂", style: "Habla relajada y natural, como una amiga de confianza.", rate: 1.0,  pitch: 1.0  },
  feliz:    { label: "Feliz",    emoji: "😄", style: "Habla con energía, alegre y entusiasta.",               rate: 1.1,  pitch: 1.18 },
  serio:    { label: "Serio",    emoji: "🧐", style: "Habla calmada, profesional y concisa.",                 rate: 0.94, pitch: 0.86 },
  creativo: { label: "Creativo", emoji: "🎨", style: "Habla imaginativa, juguetona y expresiva.",             rate: 1.04, pitch: 1.08 },
};

const URL_RE = /(https?:\/\/[^\s<>"')]+)/g;
function stripForSpeech(t: string) {
  return t.replace(URL_RE, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>]/g, "").replace(/\s{2,}/g, " ").trim();
}
function cloudTtsUrl(lang: Lang, text: string) {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text.slice(0, 200))}`;
}
function chunkText(text: string, max = 200): string[] {
  if (text.length <= max) return [text];
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) { if (cur) out.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur.trim());
  return out;
}
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
function wordOverlap(a: string, b: string): number {
  const wa = new Set(norm(a).split(" ").filter((w) => w.length > 2));
  const wb = norm(b).split(" ").filter((w) => w.length > 2);
  if (!wb.length) return 0;
  let hit = 0;
  for (const w of wb) if (wa.has(w)) hit++;
  return hit / wb.length;
}

type Msg = { id: number; role: "user" | "assistant"; content: string };

function RichText({ content }: { content: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  const re = /(https?:\/\/[^\s<>"')\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    const url = m[0];
    parts.push(
      <a key={m.index} href={url} target="_blank" rel="noopener noreferrer" className="chat-link">{url}</a>
    );
    last = m.index + url.length;
  }
  if (last < content.length) parts.push(content.slice(last));
  return <>{parts}</>;
}

export default function AvatarPage() {
  const [supported, setSupported] = useState(true);
  const [conversing, setConversing] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [surprised, setSurprised] = useState(false);
  const [mood, setMood] = useState("humano");
  const [langMode, setLangMode] = useState<"auto" | Lang>("es");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [voiceURI, setVoiceURI] = useState("");
  const [voicesState, setVoicesState] = useState<SpeechSynthesisVoice[]>([]);
  const [engine, setEngine] = useState<"cloud" | "device">("cloud");
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);

  const recognitionRef = useRef<any>(null);
  const convoRef = useRef<{ role: string; content: string }[]>([]);
  const convIdRef = useRef<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const conversingRef = useRef(false);
  const speakingRef = useRef(false);
  const spokenTextRef = useRef("");
  const moodRef = useRef("humano");
  const utterCountRef = useRef(0);
  const langRef = useRef<Lang>("es");
  const langModeRef = useRef<"auto" | Lang>("es");
  const genderRef = useRef<"male" | "female">("male");
  const manualVoiceRef = useRef("");
  const engineRef = useRef<"cloud" | "device">("cloud");
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const kickedRef = useRef(false);
  const lastSpeakEndRef = useRef(0);
  const msgIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mouthLevelRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => { moodRef.current = mood; }, [mood]);
  useEffect(() => { genderRef.current = gender; }, [gender]);
  useEffect(() => { manualVoiceRef.current = voiceURI; }, [voiceURI]);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => {
    langModeRef.current = langMode;
    langRef.current = langMode === "auto" ? browserLang() : langMode;
    if (conversingRef.current) { try { recognitionRef.current?.abort(); } catch {} setTimeout(() => startListening(), 200); }
  }, [langMode]);

  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      if (analyserRef.current && speakingRef.current) {
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 1; i < 20; i++) sum += buf[i];
        mouthLevelRef.current = Math.min(1, sum / (19 * 130));
      } else if (!speakingRef.current) {
        mouthLevelRef.current = 0;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { active = false; };
  }, []);

  function pickVoiceFor(lang: Lang): SpeechSynthesisVoice | null {
    const all = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const m = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
    if (manualVoiceRef.current) { const p = m.find((v) => v.voiceURI === manualVoiceRef.current); if (p) return p; }
    if (!m.length) return all[0] || null;
    const want = genderRef.current === "male" ? MALE_HINTS : FEMALE_HINTS;
    const avoid = genderRef.current === "male" ? FEMALE_HINTS : MALE_HINTS;
    return (
      m.find((v) => want.test(v.name) && /natural|neural|online/i.test(v.name)) ||
      m.find((v) => want.test(v.name)) ||
      m.find((v) => !avoid.test(v.name)) ||
      m[0]
    );
  }

  useEffect(() => {
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR || typeof window.speechSynthesis === "undefined") { setSupported(false); return; }
    const rec = new SR();
    rec.lang = speechLocale(langRef.current);
    rec.continuous = true; rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      const phrase = finalText.trim();
      if (!phrase || phrase.length < 2) return;
      const overlap = wordOverlap(spokenTextRef.current, phrase);
      if (speakingRef.current && overlap > 0.45) return;
      if (!speakingRef.current && Date.now() - lastSpeakEndRef.current < 1200 && overlap > 0.6) return;
      if (speakingRef.current) stopSpeaking();
      setSurprised(true); setTimeout(() => setSurprised(false), 500);
      handleUtterance(phrase);
    };
    rec.onend = () => { setListening(false); if (conversingRef.current) setTimeout(() => startListening(), 300); };
    rec.onerror = (ev: any) => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") stopConversation(); };
    recognitionRef.current = rec;
    const loadVoices = () => { const vs = window.speechSynthesis.getVoices(); voicesRef.current = vs; setVoicesState(vs); };
    loadVoices(); window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { conversingRef.current = false; try { rec.abort(); } catch {} window.speechSynthesis.cancel(); };
  }, []);

  useEffect(() => {
    if (!supported) return;
    const kick = () => { if (kickedRef.current) return; kickedRef.current = true; cleanup(); startConversation(); };
    const cleanup = () => { window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); };
    window.addEventListener("pointerdown", kick); window.addEventListener("keydown", kick);
    const ua: any = typeof navigator !== "undefined" ? (navigator as any).userActivation : null;
    const t = setTimeout(() => { if (!ua || ua.hasBeenActive) kick(); }, 350);
    return () => { clearTimeout(t); cleanup(); };
  }, [supported]);

  function startListening() {
    const rec = recognitionRef.current;
    if (!rec || !conversingRef.current) return;
    try { rec.lang = speechLocale(langRef.current); rec.start(); setListening(true); } catch {}
  }
  function stopSpeaking() {
    window.speechSynthesis.cancel();
    audioQueueRef.current = [];
    if (audioElRef.current) { audioElRef.current.onended = null; audioElRef.current.pause(); audioElRef.current = null; }
    utterCountRef.current = 0; mouthLevelRef.current = 0;
    setSpeaking(false); speakingRef.current = false; lastSpeakEndRef.current = Date.now();
  }
  function onSpeakStart() { setSpeaking(true); speakingRef.current = true; }
  function onSpeakIdle() { setSpeaking(false); speakingRef.current = false; lastSpeakEndRef.current = Date.now(); mouthLevelRef.current = 0; }

  function deviceSpeak(text: string, onDone?: () => void) {
    const m = MOODS[moodRef.current];
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoiceFor(langRef.current);
    if (v) u.voice = v;
    u.lang = speechLocale(langRef.current); u.rate = m.rate; u.pitch = m.pitch;
    u.onstart = onSpeakStart;
    u.onend = () => { utterCountRef.current = Math.max(0, utterCountRef.current - 1); if (utterCountRef.current === 0) onSpeakIdle(); onDone?.(); };
    utterCountRef.current += 1;
    window.speechSynthesis.speak(u);
  }

  function playNextCloud() {
    const text = audioQueueRef.current.shift();
    if (!text) { onSpeakIdle(); return; }
    const audio = new Audio(cloudTtsUrl(langRef.current, text));
    audio.crossOrigin = "anonymous";
    audioElRef.current = audio;
    onSpeakStart();
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") audioCtxRef.current = new AudioContext();
      const actx = audioCtxRef.current;
      if (actx.state === "suspended") actx.resume();
      const an = actx.createAnalyser(); an.fftSize = 256;
      analyserRef.current = an;
      actx.createMediaElementSource(audio).connect(an);
      an.connect(actx.destination);
    } catch {}
    let done = false;
    const finish = () => { if (done) return; done = true; audioElRef.current = null; playNextCloud(); };
    const fallback = () => { if (done) return; done = true; analyserRef.current = null; audioElRef.current = null; deviceSpeak(text, () => playNextCloud()); };
    audio.onended = finish; audio.onerror = fallback;
    audio.play().catch(fallback);
  }

  function enqueueSpeak(sentence: string) {
    const clean = stripForSpeech(sentence);
    if (!clean) return;
    spokenTextRef.current += " " + clean.toLowerCase();
    if (engineRef.current === "cloud") { for (const p of chunkText(clean)) audioQueueRef.current.push(p); if (!audioElRef.current) playNextCloud(); }
    else deviceSpeak(clean);
  }

  function systemMsg() {
    const replyLang = `IMPORTANTE: responde SIEMPRE en ${LANG_NAMES[langRef.current]}.`;
    return { role: "system", content: [BASE_PERSONA, ANTI_REPEAT, replyLang, `Tono: ${MOODS[moodRef.current].style}`, memoryPrompt()].filter(Boolean).join(" ") };
  }

  async function handleUtterance(text: string) {
    langRef.current = langModeRef.current === "auto" ? detectLang(text, langRef.current) : langModeRef.current;
    const explicit = captureFromText(text);
    if (!explicit) autoExtractMemory(text);
    convoRef.current.push({ role: "user", content: text });
    const uId = ++msgIdRef.current;
    setMessages(prev => [...prev, { id: uId, role: "user", content: text }]);
    setThinking(true); stopSpeaking(); spokenTextRef.current = "";
    let full = "", pending = "", cleared = false;
    const aId = ++msgIdRef.current;
    setMessages(prev => [...prev, { id: aId, role: "assistant", content: "" }]);
    try {
      const msgs = [systemMsg(), ...slidingWindow(convoRef.current, 24)];
      convIdRef.current = await streamChat(msgs, convIdRef.current, (delta) => {
        if (!cleared) { cleared = true; setThinking(false); }
        full += delta; pending += delta;
        setMessages(prev => prev.map(m => m.id === aId ? { ...m, content: full } : m));
        let mm: RegExpMatchArray | null;
        while ((mm = pending.match(/(.+?[.!?…\n])(\s|$)/s))) { enqueueSpeak(mm[1]); pending = pending.slice((mm.index ?? 0) + mm[0].length); }
      });
      if (pending.trim()) enqueueSpeak(pending);
      convoRef.current.push({ role: "assistant", content: full });
      setError(null);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("401") || msg.includes("403")) { setError("Sesión expirada. Inicia sesión de nuevo."); stopConversation(); }
      else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) setError("Sin conexión al servidor.");
      else setError(`Error: ${msg}`);
    } finally { setThinking(false); }
  }

  function startConversation() {
    setError(null); window.speechSynthesis.cancel();
    conversingRef.current = true; setConversing(true);
    convoRef.current = []; convIdRef.current = null; spokenTextRef.current = "";
    setMessages([]); msgIdRef.current = 0;
    langRef.current = langModeRef.current === "auto" ? browserLang() : langModeRef.current;
    startListening();
    const greeting = GREETINGS[langRef.current];
    convoRef.current.push({ role: "assistant", content: greeting });
    setMessages([{ id: ++msgIdRef.current, role: "assistant", content: greeting }]);
    enqueueSpeak(greeting);
  }
  function stopConversation() {
    conversingRef.current = false; setConversing(false); setListening(false); setThinking(false);
    stopSpeaking(); try { recognitionRef.current?.abort(); } catch {}
  }

  const face = surprised ? "surprised" : speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const effLang: Lang = langMode === "auto" ? browserLang() : langMode;
  const voicesForLang = voicesState.filter((v) => v.lang.toLowerCase().startsWith(effLang));

  return (
    <div className="avatar-page">
      <style>{css}</style>

      {error && (
        <div className="error-banner">
          ⚠️ {error}
          <button onClick={() => setError(null)} className="error-close">✕</button>
        </div>
      )}
      {!supported && (
        <div className="error-banner">⚠️ Tu navegador no soporta reconocimiento de voz. Prueba Chrome en escritorio.</div>
      )}

      <div className="av-layout">
        <div className={`stage mood-${mood}`}>
          <AIOrb state={face} mood={mood} mouthLevelRef={mouthLevelRef} />
          <div className="status-pill">
            {speaking ? "● Hablando" : thinking ? "… Pensando" : listening ? "🎙 Escuchando" : conversing ? "En vivo" : "Pausado"}
          </div>
        </div>

        {messages.length > 0 && (
          <div className="transcript" ref={transcriptRef}>
            {messages.map(m => (
              <div key={m.id} className={`tmsg tmsg-${m.role}`}>
                {m.role === "assistant" && <span className="tmsg-label">Mata AI</span>}
                <div className="tmsg-bubble">
                  {m.content
                    ? <RichText content={m.content} />
                    : m.role === "assistant" && <span className="dots"><span /><span /><span /></span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="controls">
        {conversing
          ? <button onClick={stopConversation} className="btn stop">■ Terminar</button>
          : <button onClick={startConversation} disabled={!supported} className="btn">🎤 Hablar</button>}
        <div className="seg">
          {LANG_OPTS.map(o => (
            <button key={o.key} onClick={() => setLangMode(o.key)} className={`seg-btn ${langMode === o.key ? "on" : ""}`}>{o.label}</button>
          ))}
        </div>
        <div className="seg">
          {Object.entries(MOODS).map(([k, m]) => (
            <button key={k} onClick={() => setMood(k)} className={`seg-btn ${mood === k ? "on" : ""}`} title={m.label}>{m.emoji}</button>
          ))}
        </div>
        <button onClick={() => setShowSettings(s => !s)} className="seg-btn">⚙️</button>
      </div>

      {showSettings && (
        <div className="settings">
          <div className="seg">
            <button onClick={() => setEngine("cloud")} className={`seg-btn ${engine === "cloud" ? "on" : ""}`}>🌟 Voz nube</button>
            <button onClick={() => setEngine("device")} className={`seg-btn ${engine === "device" ? "on" : ""}`}>💻 Dispositivo</button>
          </div>
          {engine === "device" && (
            <div className="seg">
              <button onClick={() => setGender("male")} className={`seg-btn ${gender === "male" ? "on" : ""}`}>👨</button>
              <button onClick={() => setGender("female")} className={`seg-btn ${gender === "female" ? "on" : ""}`}>👩</button>
              <select value={voiceURI} onChange={e => setVoiceURI(e.target.value)} className="vsel">
                <option value="">Voz automática</option>
                {voicesForLang.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>)}
              </select>
            </div>
          )}
          <p className="hint">💡 Usa audífonos para evitar eco.</p>
        </div>
      )}
    </div>
  );
}

// ── AI Orb Avatar (estilo asistente de voz IA, tipo ChatGPT) ──────────────────
function AIOrb({ state, mouthLevelRef }: {
  state: string; mood: string; mouthLevelRef: React.MutableRefObject<number>;
}) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const stRef = useRef(state);
  useEffect(() => { stRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = cvs.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;

    const COLORS: Record<string, [number, number, number]> = {
      idle:      [34, 211, 238],
      listening: [168, 85, 247],
      thinking:  [234, 179, 8],
      speaking:  [16, 185, 129],
      surprised: [244, 114, 182],
    };

    const s = { t: 0, level: 0, breath: 0, rot: 0, curCol: [34, 211, 238] as number[] };
    const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.min(t, 1);
    const lerpCol = (a: number[], b: number[], t: number) =>
      [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

    function tick(dt: number) {
      s.t += dt;
      const st = stRef.current;
      const pal = COLORS[st] || COLORS.idle;
      s.curCol = lerpCol(s.curCol, pal, dt * 3);
      const target =
        st === "speaking"  ? mouthLevelRef.current :
        st === "thinking"  ? 0.22 + Math.abs(Math.sin(s.t * 3)) * 0.16 :
        st === "listening" ? 0.10 + Math.abs(Math.sin(s.t * 1.5)) * 0.12 :
        st === "surprised" ? 0.7 :
                             0.04 + Math.abs(Math.sin(s.t * 0.8)) * 0.05;
      s.level = lerp(s.level, target, dt * (st === "speaking" ? 18 : 6));
      s.breath = Math.sin(s.t * 0.9) * 0.5 + 0.5;
      s.rot += dt * (st === "thinking" ? 1.6 : 0.45);
      ctx.clearRect(0, 0, W, H);
      draw();
    }

    function draw() {
      const [r, g, b] = s.curCol.map(Math.round);
      const baseR = Math.min(W, H) * 0.19;
      const R = baseR * (1 + s.level * 0.35 + s.breath * 0.05);

      // Ambient glow
      const amb = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.55);
      amb.addColorStop(0, `rgba(${r},${g},${b},0.18)`);
      amb.addColorStop(0.5, `rgba(${r},${g},${b},0.05)`);
      amb.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = amb; ctx.fillRect(0, 0, W, H);

      // Reactive waveform rings
      for (let ring = 0; ring < 3; ring++) {
        const rr = R * (1.25 + ring * 0.22);
        ctx.beginPath();
        const pts = 80;
        for (let i = 0; i <= pts; i++) {
          const ang = (i / pts) * Math.PI * 2;
          const wob = Math.sin(ang * 4 + s.t * 2 + ring) * (3 + s.level * 22)
                    + Math.sin(ang * 7 - s.t * 1.5 + ring * 2) * (2 + s.level * 10);
          const rad = rr + wob;
          const x = cx + Math.cos(ang) * rad;
          const y = cy + Math.sin(ang) * rad;
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.22 - ring * 0.06})`;
        ctx.lineWidth = 1.5; ctx.stroke();
      }

      // Orbiting particles
      for (let i = 0; i < 14; i++) {
        const ang = s.rot + (i / 14) * Math.PI * 2;
        const dist = R * 1.5 + Math.sin(s.t * 1.3 + i) * 12;
        const x = cx + Math.cos(ang) * dist;
        const y = cy + Math.sin(ang) * dist * 0.95;
        const sz = 1.2 + (Math.sin(s.t * 2 + i) * 0.5 + 0.5) * 2.2;
        const al = 0.25 + (Math.sin(s.t * 2 + i) * 0.5 + 0.5) * 0.5 * (0.4 + s.level);
        ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${al})`;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`; ctx.shadowBlur = 8;
        ctx.fill(); ctx.shadowBlur = 0;
      }

      // Halo
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.15, 0, Math.PI * 2);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.5, cx, cy, R * 1.15);
      halo.addColorStop(0, `rgba(${r},${g},${b},0.35)`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = halo; ctx.fill();

      // Core sphere
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
      const core = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.1);
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.25, `rgba(${Math.min(255, r + 60)},${Math.min(255, g + 60)},${Math.min(255, b + 60)},0.95)`);
      core.addColorStop(0.7, `rgba(${r},${g},${b},0.95)`);
      core.addColorStop(1, `rgba(${Math.round(r * 0.4)},${Math.round(g * 0.4)},${Math.round(b * 0.45)},1)`);
      ctx.fillStyle = core; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      // Liquid swirls inside
      const swirls: number[][] = [[255, 255, 255], [r, g, b], [Math.min(255, r + 80), Math.min(255, g + 80), Math.min(255, b + 80)]];
      for (let i = 0; i < 3; i++) {
        const ox = Math.cos(s.t * 0.7 + i * 2.1) * R * 0.35;
        const oy = Math.sin(s.t * 0.9 + i * 1.7) * R * 0.35;
        const sw = ctx.createRadialGradient(cx + ox, cy + oy, 0, cx + ox, cy + oy, R * 0.8);
        const cc = swirls[i];
        sw.addColorStop(0, `rgba(${cc[0]},${cc[1]},${cc[2]},${0.18 + s.level * 0.25})`);
        sw.addColorStop(1, `rgba(${cc[0]},${cc[1]},${cc[2]},0)`);
        ctx.fillStyle = sw; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }

      // Top specular highlight
      const spec = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 0, cx - R * 0.35, cy - R * 0.4, R * 0.6);
      spec.addColorStop(0, "rgba(255,255,255,0.85)");
      spec.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = spec; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      // Rim light
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1.5; ctx.stroke();
    }

    let last = 0;
    function loop(ts: number) {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts; tick(dt);
      raf.current = requestAnimationFrame(loop);
    }
    raf.current = requestAnimationFrame((ts) => { last = ts; loop(ts); });
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return <canvas ref={cvs} width={560} height={600} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />;
}

// ── (legacy) Ultra Realistic Human Avatar — ya no se usa ──────────────────────
function _HumanAvatarLegacy({ state, mood, mouthLevelRef }: {
  state: string; mood: string; mouthLevelRef: React.MutableRefObject<number>;
}) {
  const cvs = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const stRef = useRef(state);
  const mdRef = useRef(mood);
  useEffect(() => { stRef.current = state; }, [state]);
  useEffect(() => { mdRef.current = mood; }, [mood]);

  useEffect(() => {
    const canvas = cvs.current; if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;   // taken from JSX attrs (560)
    const H = canvas.height;  // taken from JSX attrs (600)

    const a = {
      t: 0,
      blinkT: 0, nextBlink: 2.5 + Math.random() * 3, blinking: false, blinkAmt: 0,
      eyeX: 0, eyeY: 0, eyeTX: 0, eyeTY: 0,
      mouthOpen: 0, smileAmt: 0.15,
      browLift: 0, browLiftTgt: 0,
      floatY: 0, headTilt: 0, headTiltTgt: 0,
    };
    let eyeT = 0;
    const schedEye = () => { eyeT = 1.5 + Math.random() * 2.5; };
    schedEye();
    const L = (a: number, b: number, t: number) => a + (b - a) * Math.min(t, 1);

    function tick(dt: number) {
      a.t += dt; a.blinkT += dt; eyeT -= dt;
      const st = stRef.current, md = mdRef.current;

      if (eyeT <= 0) {
        schedEye();
        a.eyeTX = st === "thinking" ? (Math.random() - 0.7) * 16 : (Math.random() - 0.5) * 10;
        a.eyeTY = st === "thinking" ? -9 + Math.random() * -5 : (Math.random() - 0.5) * 5;
      }
      a.eyeX = L(a.eyeX, a.eyeTX, dt * 5);
      a.eyeY = L(a.eyeY, a.eyeTY, dt * 5);

      if (!a.blinking && a.blinkT >= a.nextBlink) {
        a.blinking = true; a.blinkT = 0; a.nextBlink = 3 + Math.random() * 4.5;
      }
      if (a.blinking) {
        const p = a.blinkT / 0.11;
        a.blinkAmt = p < 0.5 ? p * 2 : p < 1 ? 2 - p * 2 : 0;
        if (a.blinkT >= 0.11) { a.blinking = false; a.blinkAmt = 0; }
      }
      if (st === "surprised") a.blinkAmt = 0;

      const audioLv = mouthLevelRef.current;
      const mTgt = st === "speaking"
        ? Math.max(audioLv * 1.3, 0.07 + Math.abs(Math.sin(a.t * 16)) * 0.18 + Math.abs(Math.sin(a.t * 9)) * 0.1)
        : st === "surprised" ? 0.72 : st === "thinking" ? 0.04 : 0;
      a.mouthOpen = L(a.mouthOpen, mTgt, dt * (st === "speaking" ? 24 : 9));

      a.smileAmt = L(a.smileAmt, md === "feliz" ? 1 : md === "serio" ? -0.25 : md === "creativo" ? 0.6 : 0.15, dt * 3);
      a.browLiftTgt = st === "surprised" ? 1 : st === "thinking" ? -0.65 : md === "feliz" ? 0.35 : 0;
      a.browLift = L(a.browLift, a.browLiftTgt, dt * 4);
      a.floatY = Math.sin(a.t * 0.6) * 9 + Math.sin(a.t * 1.1) * 2.5;
      a.headTiltTgt = st === "listening" ? Math.sin(a.t * 0.55) * 9 : 0;
      a.headTilt = L(a.headTilt, a.headTiltTgt, dt * 2);

      ctx.clearRect(0, 0, W, H);
      drawBg(ctx, W, H, st, a.t);
      ctx.save();
      ctx.translate(W / 2, H / 2 + 35 + a.floatY);
      ctx.rotate((a.headTilt * Math.PI) / 180);
      drawAll(ctx, a, st, md);
      ctx.restore();
    }

    function drawBg(ctx: CanvasRenderingContext2D, W: number, H: number, st: string, t: number) {
      const C: Record<string, [number, number, number]> = {
        speaking: [16, 185, 129], thinking: [234, 179, 8], listening: [168, 85, 247],
        surprised: [239, 68, 68], idle: [34, 211, 238],
      };
      const [r, g, b] = C[st] || C.idle;
      const grd = ctx.createRadialGradient(W / 2, H * 0.55, 20, W / 2, H * 0.55, 280);
      grd.addColorStop(0, `rgba(${r},${g},${b},0.14)`);
      grd.addColorStop(0.5, `rgba(${r},${g},${b},0.05)`);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 + t * 0.2 + i * 0.4;
        const rad = 190 + Math.sin(t + i * 1.3) * 28;
        const px = W / 2 + Math.cos(angle) * rad;
        const py = H / 2 + Math.sin(angle) * rad * 0.45 + 40;
        const alpha = (Math.sin(t * 1.8 + i * 1.2) * 0.5 + 0.5) * 0.28;
        ctx.beginPath(); ctx.arc(px, py, 1.8 + Math.sin(t + i) * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`; ctx.fill();
      }
    }

    function drawAll(ctx: CanvasRenderingContext2D, a: Record<string, any>, st: string, md: string) {
      drawNeckBody(ctx);
      drawHairBack(ctx, a.t);
      drawHead(ctx);
      drawEars(ctx);
      drawNose(ctx);
      drawMouth(ctx, a);
      drawEyes(ctx, a, st);
      drawBrows(ctx, a, st, md);
      drawHairFront(ctx, a.t);
      drawSpecular(ctx);
    }

    // Neck + shoulders
    function drawNeckBody(ctx: CanvasRenderingContext2D) {
      // Shoulders
      ctx.save();
      const sg = ctx.createLinearGradient(-160, 140, 160, 200);
      sg.addColorStop(0, "#151030"); sg.addColorStop(0.5, "#1e1545"); sg.addColorStop(1, "#151030");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(-180, 220); ctx.bezierCurveTo(-160, 140, -60, 128, 0, 128);
      ctx.bezierCurveTo(60, 128, 160, 140, 180, 220); ctx.lineTo(180, 300); ctx.lineTo(-180, 300);
      ctx.closePath(); ctx.fill();
      // collar glow
      const C: Record<string, [number, number, number]> = {
        speaking: [16, 185, 129], thinking: [234, 179, 8], listening: [168, 85, 247],
        surprised: [239, 68, 68], idle: [34, 211, 238],
      };
      const [r, g, b] = C[stRef.current] || C.idle;
      ctx.beginPath(); ctx.ellipse(0, 152, 120, 22, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},0.3)`; ctx.fill();
      ctx.restore();
      // Neck
      ctx.save();
      const ng = ctx.createLinearGradient(-24, 95, 24, 95);
      ng.addColorStop(0, "#c8906a"); ng.addColorStop(0.4, "#e0b080"); ng.addColorStop(1, "#b87850");
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.roundRect(-22, 92, 44, 60, 6); ctx.fill();
      // neck shadow
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      ctx.beginPath(); ctx.ellipse(0, 150, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Hair behind head
    function drawHairBack(ctx: CanvasRenderingContext2D, t: number) {
      ctx.save();
      const hg = ctx.createRadialGradient(-30, -120, 10, 0, -60, 160);
      hg.addColorStop(0, "#3a2560"); hg.addColorStop(0.5, "#211440"); hg.addColorStop(1, "#120a25");
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.moveTo(-92, -85);
      ctx.bezierCurveTo(-110, -50, -108, 30, -88, 75);
      ctx.bezierCurveTo(-70, 110, -40, 130, 0, 130);
      ctx.bezierCurveTo(40, 130, 70, 110, 88, 75);
      ctx.bezierCurveTo(108, 30, 110, -50, 92, -85);
      ctx.bezierCurveTo(70, -145, -70, -145, -92, -85);
      ctx.closePath(); ctx.fill();
      // Hair sheen
      ctx.beginPath();
      ctx.moveTo(-50, -130); ctx.bezierCurveTo(-20, -150, 20, -148, 50, -128);
      ctx.strokeStyle = "rgba(160,100,255,0.18)"; ctx.lineWidth = 8; ctx.stroke();
      ctx.restore();
    }

    // Face base (skin)
    function drawHead(ctx: CanvasRenderingContext2D) {
      ctx.save();
      // Face shape
      ctx.beginPath();
      ctx.moveTo(-78, -108);
      ctx.bezierCurveTo(-58, -138, 58, -138, 78, -108);
      ctx.bezierCurveTo(100, -78, 100, -18, 96, 22);
      ctx.bezierCurveTo(92, 62, 70, 100, 42, 118);
      ctx.bezierCurveTo(22, 130, -22, 130, -42, 118);
      ctx.bezierCurveTo(-70, 100, -92, 62, -96, 22);
      ctx.bezierCurveTo(-100, -18, -100, -78, -78, -108);
      ctx.closePath();

      // Main skin gradient
      const sg = ctx.createRadialGradient(-18, -52, 15, 2, -10, 175);
      sg.addColorStop(0, "#fae8d2"); sg.addColorStop(0.22, "#f0d0a8");
      sg.addColorStop(0.55, "#e8be90"); sg.addColorStop(0.82, "#d4a070"); sg.addColorStop(1, "#b87848");
      ctx.fillStyle = sg; ctx.fill();

      // SSS warm edge glow
      ctx.save(); ctx.clip();
      const sss = ctx.createRadialGradient(0, 0, 55, 0, 0, 140);
      sss.addColorStop(0, "rgba(255,140,90,0)");
      sss.addColorStop(0.75, "rgba(255,110,70,0.05)");
      sss.addColorStop(1, "rgba(210,70,40,0.12)");
      ctx.fillStyle = sss;
      ctx.fillRect(-120, -150, 240, 300);
      ctx.restore();

      // Forehead specular
      const fh = ctx.createRadialGradient(-12, -90, 5, -12, -90, 75);
      fh.addColorStop(0, "rgba(255,252,240,0.5)");
      fh.addColorStop(0.4, "rgba(255,240,215,0.18)");
      fh.addColorStop(1, "rgba(255,220,185,0)");
      ctx.fillStyle = fh; ctx.fill();

      // Temple/jaw shadow
      const ts = ctx.createRadialGradient(0, 0, 70, 0, 0, 140);
      ts.addColorStop(0, "rgba(0,0,0,0)");
      ts.addColorStop(0.7, "rgba(0,0,0,0.04)");
      ts.addColorStop(1, "rgba(0,0,0,0.2)");
      ctx.fillStyle = ts; ctx.fill();

      // Under-chin shadow
      const cs = ctx.createRadialGradient(0, 125, 15, 0, 145, 90);
      cs.addColorStop(0, "rgba(0,0,0,0.3)"); cs.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = cs; ctx.fill();

      // Cheek blush
      ctx.fillStyle = "rgba(220,110,90,0.07)";
      ctx.beginPath(); ctx.ellipse(-55, 15, 30, 20, -0.3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(55, 15, 30, 20, 0.3, 0, Math.PI * 2); ctx.fill();

      ctx.restore();
    }

    // Ears
    function drawEars(ctx: CanvasRenderingContext2D) {
      for (const s of [-1, 1]) {
        ctx.save(); ctx.translate(s * 97, -8); ctx.scale(s, 1);
        ctx.beginPath();
        ctx.moveTo(-3, -26); ctx.bezierCurveTo(12, -28, 20, -18, 20, -4);
        ctx.bezierCurveTo(20, 14, 12, 27, 0, 28); ctx.bezierCurveTo(-9, 28, -10, 20, -8, 8);
        ctx.bezierCurveTo(-6, -2, -4, -12, -3, -26);
        const eg = ctx.createLinearGradient(-10, 0, 20, 0);
        eg.addColorStop(0, "#c88858"); eg.addColorStop(0.5, "#e8b878"); eg.addColorStop(1, "#b87048");
        ctx.fillStyle = eg; ctx.fill();
        ctx.fillStyle = "rgba(120,60,30,0.22)";
        ctx.beginPath(); ctx.moveTo(2, -16); ctx.bezierCurveTo(12, -18, 16, -6, 15, 6);
        ctx.bezierCurveTo(13, 18, 5, 24, 0, 21); ctx.fill();
        // Ear lobe
        ctx.beginPath(); ctx.ellipse(0, 27, 7, 7, 0, 0, Math.PI * 2);
        ctx.fillStyle = "#d89060"; ctx.fill();
        // Earring glow
        const [r2, g2, b2] = [34, 211, 238];
        ctx.beginPath(); ctx.arc(0, 32, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r2},${g2},${b2},0.85)`; ctx.fill();
        ctx.shadowColor = `rgba(${r2},${g2},${b2},1)`; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
        ctx.restore();
      }
    }

    // Nose
    function drawNose(ctx: CanvasRenderingContext2D) {
      ctx.save(); ctx.translate(0, 8);
      // Bridge highlight
      ctx.beginPath(); ctx.moveTo(-3, -48); ctx.bezierCurveTo(-2, -20, -2, 0, 0, 12);
      ctx.strokeStyle = "rgba(255,240,210,0.35)"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.stroke();
      // Nose shape shadow
      ctx.beginPath(); ctx.moveTo(-9, -18); ctx.bezierCurveTo(-14, 2, -12, 18, -7, 22);
      ctx.bezierCurveTo(-3, 26, 3, 26, 7, 22); ctx.bezierCurveTo(12, 18, 14, 2, 9, -18);
      ctx.strokeStyle = "rgba(140,75,40,0.22)"; ctx.lineWidth = 2.5; ctx.stroke();
      // Tip highlight
      const nt = ctx.createRadialGradient(0, 22, 0, 0, 22, 10);
      nt.addColorStop(0, "rgba(255,240,215,0.4)"); nt.addColorStop(1, "rgba(255,220,185,0)");
      ctx.fillStyle = nt; ctx.beginPath(); ctx.arc(0, 22, 12, 0, Math.PI * 2); ctx.fill();
      // Nostrils
      ctx.fillStyle = "rgba(110,55,30,0.28)";
      ctx.beginPath(); ctx.ellipse(-9, 26, 6, 4, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, 26, 6, 4, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Mouth with realistic lips
    function drawMouth(ctx: CanvasRenderingContext2D, a: Record<string, any>) {
      ctx.save(); ctx.translate(0, 62);
      const mo = a.mouthOpen;  // 0–1
      const sm = a.smileAmt;   // -1 to 1
      const W2 = 42 + mo * 14;
      const H2 = 6 + mo * 28;
      const curve = sm * 10;   // smile curves lip corners up

      // Mouth opening / interior
      if (mo > 0.04) {
        ctx.save();
        // Clip to lip shape
        ctx.beginPath();
        ctx.moveTo(-W2 / 2, 0);
        ctx.bezierCurveTo(-W2 / 3, curve - 2, W2 / 3, curve - 2, W2 / 2, 0);
        ctx.bezierCurveTo(W2 / 3, curve + H2 + 4, -W2 / 3, curve + H2 + 4, -W2 / 2, 0);
        ctx.clip();
        // Dark interior
        const ig = ctx.createLinearGradient(0, 0, 0, H2 + curve + 4);
        ig.addColorStop(0, "#1a0810"); ig.addColorStop(0.4, "#2a0e18"); ig.addColorStop(1, "#150608");
        ctx.fillStyle = ig; ctx.fillRect(-W2 / 2, -5, W2, H2 + curve + 15);
        // Upper teeth
        if (mo > 0.18) {
          ctx.fillStyle = "#f0ece4";
          ctx.beginPath();
          ctx.moveTo(-W2 / 2 + 5, 0); ctx.bezierCurveTo(-W2 / 3, curve + 1, W2 / 3, curve + 1, W2 / 2 - 5, 0);
          ctx.lineTo(W2 / 2 - 5, H2 * 0.32 + curve); ctx.bezierCurveTo(W2 / 3, H2 * 0.38 + curve, -W2 / 3, H2 * 0.38 + curve, -W2 / 2 + 5, H2 * 0.32 + curve);
          ctx.closePath(); ctx.fill();
          // tooth lines
          ctx.strokeStyle = "rgba(180,165,145,0.3)"; ctx.lineWidth = 0.6;
          for (let i = -3; i <= 3; i++) {
            ctx.beginPath(); ctx.moveTo(i * 6, curve); ctx.lineTo(i * 6, H2 * 0.33 + curve); ctx.stroke();
          }
          // tongue hint
          if (mo > 0.35) {
            const tg = ctx.createRadialGradient(0, H2 * 0.55 + curve, 2, 0, H2 * 0.6 + curve, 22);
            tg.addColorStop(0, "rgba(200,80,80,0.7)"); tg.addColorStop(1, "rgba(160,50,50,0)");
            ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(0, H2 * 0.6 + curve, 20, 14, 0, 0, Math.PI * 2); ctx.fill();
          }
        }
        ctx.restore();
      }

      // Upper lip (cupid's bow shape)
      ctx.beginPath();
      ctx.moveTo(-W2 / 2, 0);
      ctx.bezierCurveTo(-W2 * 0.35, curve - 8, -W2 * 0.12, curve - 10, 0, curve - 6);
      ctx.bezierCurveTo(W2 * 0.12, curve - 10, W2 * 0.35, curve - 8, W2 / 2, 0);
      ctx.bezierCurveTo(W2 * 0.3, curve + 4, W2 * 0.1, curve + 6, 0, curve + 6);
      ctx.bezierCurveTo(-W2 * 0.1, curve + 6, -W2 * 0.3, curve + 4, -W2 / 2, 0);
      ctx.fillStyle = "#b84848"; ctx.fill();
      // Philtrum dip highlight
      const ph = ctx.createLinearGradient(0, curve - 10, 0, -8);
      ph.addColorStop(0, "rgba(200,130,100,0.3)"); ph.addColorStop(1, "rgba(200,130,100,0)");
      ctx.fillStyle = ph; ctx.beginPath(); ctx.ellipse(0, curve - 12, 8, 8, 0, 0, Math.PI * 2); ctx.fill();

      // Lower lip
      ctx.beginPath();
      ctx.moveTo(-W2 / 2, 0);
      ctx.bezierCurveTo(-W2 * 0.3, curve + H2 * 0.5, W2 * 0.3, curve + H2 * 0.5, W2 / 2, 0);
      ctx.bezierCurveTo(W2 * 0.3, curve + H2 + 8, -W2 * 0.3, curve + H2 + 8, -W2 / 2, 0);
      ctx.fillStyle = "#c85858"; ctx.fill();
      // Lower lip highlight
      const lh = ctx.createRadialGradient(0, curve + H2 * 0.5, 0, 0, curve + H2 * 0.5, 18);
      lh.addColorStop(0, "rgba(255,200,180,0.4)"); lh.addColorStop(1, "rgba(255,180,150,0)");
      ctx.fillStyle = lh; ctx.beginPath(); ctx.ellipse(0, curve + H2 * 0.5, 16, 8, 0, 0, Math.PI * 2); ctx.fill();

      // Lip border / vermilion edge
      ctx.strokeStyle = "rgba(140,50,50,0.2)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-W2 / 2, 0); ctx.bezierCurveTo(-W2 / 3, curve - 8, W2 / 3, curve - 8, W2 / 2, 0); ctx.stroke();

      ctx.restore();
    }

    // Eyes — the most detailed part
    function drawEyes(ctx: CanvasRenderingContext2D, a: Record<string, any>, st: string) {
      const positions = [[-52, -33], [52, -33]] as [number, number][];
      for (let i = 0; i < 2; i++) {
        const [ex, ey] = positions[i];
        const blink = a.blinkAmt;
        ctx.save(); ctx.translate(ex, ey);

        // Eye socket shadow (AO)
        ctx.beginPath(); ctx.ellipse(0, 2, 28, 20, 0, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.1)"; ctx.fill();

        // Sclera shape (not ellipse — proper eyelid shape)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(-22, 0);
        ctx.bezierCurveTo(-10, -16, 10, -16, 22, 0);
        ctx.bezierCurveTo(10, 13, -10, 13, -22, 0);
        ctx.clip();

        // Sclera fill
        const sc = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
        sc.addColorStop(0, "#faf7f3"); sc.addColorStop(0.7, "#f0ece6"); sc.addColorStop(1, "#e0d8d0");
        ctx.fillStyle = sc; ctx.fillRect(-25, -18, 50, 32);

        // Sclera vein hints (corners)
        ctx.strokeStyle = "rgba(220,140,140,0.12)"; ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(-20, 0); ctx.bezierCurveTo(-16, -3, -12, -1, -8, 1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.bezierCurveTo(16, 3, 12, 1, 8, -1); ctx.stroke();

        // Iris
        const px = a.eyeX * 0.55, py = a.eyeY * 0.5;
        ctx.save(); ctx.translate(px, py);
        ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.clip();

        // Iris base gradient (deep brown/amber)
        const ig = ctx.createRadialGradient(-2, -2, 0, 0, 0, 11);
        ig.addColorStop(0, "#8b5e30"); ig.addColorStop(0.3, "#6b4020"); ig.addColorStop(0.7, "#4a2810"); ig.addColorStop(1, "#1a0c04");
        ctx.fillStyle = ig; ctx.fillRect(-12, -12, 24, 24);

        // Iris fibers (radial spokes)
        for (let j = 0; j < 40; j++) {
          const angle = (j / 40) * Math.PI * 2;
          const shade = 0.1 + Math.random() * 0.12;
          ctx.beginPath();
          ctx.moveTo(Math.cos(angle) * 3, Math.sin(angle) * 3);
          ctx.lineTo(Math.cos(angle) * 10.5, Math.sin(angle) * 10.5);
          ctx.strokeStyle = `rgba(180,120,60,${shade})`;
          ctx.lineWidth = 0.5; ctx.stroke();
        }

        // Limbal ring
        ctx.beginPath(); ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(10,5,2,0.85)"; ctx.lineWidth = 1.5; ctx.stroke();

        // Pupil
        ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#08050a"; ctx.fill();

        // Main catchlight
        ctx.beginPath(); ctx.arc(-3.5, -3.5, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.fill();
        // Secondary catchlight
        ctx.beginPath(); ctx.arc(2.5, 2.5, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.fill();

        ctx.restore(); // pupil translate
        ctx.restore(); // sclera clip

        // Eyelid crease shadow
        ctx.beginPath();
        ctx.moveTo(-22, -1); ctx.bezierCurveTo(-10, -20, 10, -20, 22, -1);
        ctx.strokeStyle = "rgba(140,80,50,0.15)"; ctx.lineWidth = 3; ctx.stroke();

        // Upper eyelid skin overlay (blink)
        if (blink > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(-22, 0); ctx.bezierCurveTo(-10, -16, 10, -16, 22, 0);
          ctx.bezierCurveTo(10, 13, -10, 13, -22, 0); ctx.clip();
          // lid comes down from top
          ctx.fillStyle = "#e8be90";
          ctx.fillRect(-26, -18, 52, 18 + 32 * blink);
          ctx.restore();
        }

        // Upper lash line
        ctx.beginPath();
        ctx.moveTo(-22, 0); ctx.bezierCurveTo(-10, -17, 10, -17, 22, 0);
        ctx.strokeStyle = "#1a0e06"; ctx.lineWidth = 2.5; ctx.stroke();

        // Individual upper lashes
        const lashCount = 18;
        for (let j = 0; j < lashCount; j++) {
          const t2 = j / (lashCount - 1);
          const lx = -22 + t2 * 44;
          const baseY = t2 < 0.5
            ? -17 * Math.sin(Math.PI * (t2 * 2))
            : -17 * Math.sin(Math.PI * ((1 - t2) * 2));
          const len = 7 + Math.sin(t2 * Math.PI) * 5;
          const curl = -len * 0.6;
          ctx.beginPath();
          ctx.moveTo(lx, baseY);
          ctx.bezierCurveTo(lx + (t2 - 0.5) * 4, baseY - len * 0.5, lx + (t2 - 0.5) * 6, baseY + curl, lx + (t2 - 0.5) * 8, baseY + curl - 2);
          ctx.strokeStyle = "rgba(18,10,4,0.9)"; ctx.lineWidth = 0.9; ctx.stroke();
        }

        // Lower lash shadow
        ctx.beginPath(); ctx.moveTo(-20, 0); ctx.bezierCurveTo(-8, 14, 8, 14, 20, 0);
        ctx.strokeStyle = "rgba(100,60,40,0.2)"; ctx.lineWidth = 1.5; ctx.stroke();

        ctx.restore(); // eye translate
      }
    }

    // Eyebrows — arched, natural
    function drawBrows(ctx: CanvasRenderingContext2D, a: Record<string, any>, st: string, md: string) {
      const positions = [[-52, -60], [52, -60]] as [number, number][];
      for (let i = 0; i < 2; i++) {
        const [bx, by] = positions[i];
        const lift = a.browLift * 12;
        const tilt = i === 0 ? a.browLift * -0.28 : a.browLift * 0.28;
        const angry = st === "thinking" ? (i === 0 ? 0.18 : -0.18) : 0;
        ctx.save(); ctx.translate(bx, by - lift); ctx.rotate(tilt + angry);

        // Brow shape (arch)
        ctx.beginPath();
        if (i === 0) { // left brow
          ctx.moveTo(-22, 6); ctx.bezierCurveTo(-16, -5, 0, -9, 18, -2); ctx.bezierCurveTo(22, 0, 22, 4, 18, 6);
          ctx.bezierCurveTo(8, 8, -6, 6, -22, 6);
        } else { // right brow
          ctx.moveTo(22, 6); ctx.bezierCurveTo(16, -5, 0, -9, -18, -2); ctx.bezierCurveTo(-22, 0, -22, 4, -18, 6);
          ctx.bezierCurveTo(-8, 8, 6, 6, 22, 6);
        }
        ctx.fillStyle = "#2a1808"; ctx.fill();

        // Brow hair direction lines
        ctx.strokeStyle = "rgba(60,30,10,0.15)"; ctx.lineWidth = 0.7;
        for (let j = 0; j < 8; j++) {
          const tx = -18 + j * 5;
          ctx.beginPath(); ctx.moveTo(tx, 5); ctx.lineTo(tx + (i === 0 ? 3 : -3), -3); ctx.stroke();
        }
        // Brow highlight
        ctx.beginPath(); ctx.ellipse(i === 0 ? -5 : 5, -2, 14, 2.5, i === 0 ? -0.2 : 0.2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(100,65,30,0.25)"; ctx.fill();

        ctx.restore();
      }
    }

    // Hair front (on top of face)
    function drawHairFront(ctx: CanvasRenderingContext2D, t: number) {
      ctx.save();
      const hg = ctx.createLinearGradient(0, -145, 0, -80);
      hg.addColorStop(0, "#2a1850"); hg.addColorStop(1, "#1a0e38");

      // Top hairline + widow's peak
      ctx.beginPath();
      ctx.moveTo(-82, -88);
      ctx.bezierCurveTo(-78, -142, -40, -162, 0, -158);
      ctx.bezierCurveTo(40, -162, 78, -142, 82, -88);
      ctx.bezierCurveTo(65, -115, 30, -125, 0, -120);
      ctx.bezierCurveTo(-30, -125, -65, -115, -82, -88);
      ctx.fillStyle = hg; ctx.fill();

      // Side hair falls
      for (const s of [-1, 1]) {
        ctx.save(); ctx.scale(s, 1);
        ctx.beginPath();
        ctx.moveTo(80, -88);
        ctx.bezierCurveTo(95, -50, 95, 15, 78, 55);
        ctx.bezierCurveTo(72, 75, 60, 90, 48, 100);
        ctx.bezierCurveTo(68, 85, 82, 60, 88, 20);
        ctx.bezierCurveTo(94, -20, 90, -60, 72, -90);
        ctx.fillStyle = "#1a0e38"; ctx.fill();
        ctx.restore();
      }

      // Individual strand highlights (animated)
      ctx.strokeStyle = "rgba(130,80,200,0.15)"; ctx.lineWidth = 1.5; ctx.lineCap = "round";
      for (let j = 0; j < 6; j++) {
        const ox = -40 + j * 16;
        const wave = Math.sin(t * 0.4 + j) * 3;
        ctx.beginPath(); ctx.moveTo(ox, -155); ctx.bezierCurveTo(ox + wave, -120, ox + wave * 1.5, -95, ox + wave * 2, -88);
        ctx.stroke();
      }

      ctx.restore();
    }

    // Final specular pass
    function drawSpecular(ctx: CanvasRenderingContext2D) {
      // Nose tip
      ctx.save();
      const nt = ctx.createRadialGradient(-1, 30, 0, -1, 30, 8);
      nt.addColorStop(0, "rgba(255,248,235,0.5)"); nt.addColorStop(1, "rgba(255,240,215,0)");
      ctx.fillStyle = nt; ctx.beginPath(); ctx.arc(-1, 30, 8, 0, Math.PI * 2); ctx.fill();
      // Cheekbone highlights
      ctx.fillStyle = "rgba(255,248,230,0.12)";
      ctx.beginPath(); ctx.ellipse(-60, -5, 22, 14, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(60, -5, 22, 14, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    let last = 0;
    function loop(ts: number) {
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts; tick(dt);
      raf.current = requestAnimationFrame(loop);
    }
    raf.current = requestAnimationFrame((ts) => { last = ts; loop(ts); });
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return <canvas ref={cvs} width={560} height={600} style={{ width: "100%", height: "100%", display: "block" }} />;
}

const css = `
.avatar-page { display:flex; flex-direction:column; align-items:center; gap:12px; width:100%; padding:0 8px; box-sizing:border-box; }
.av-layout { display:flex; flex-direction:column; align-items:center; gap:0; width:100%; max-width:640px; }
.stage { position:relative; width:100%; max-width:640px; height:52vw; min-height:280px; max-height:520px; border-radius:20px; overflow:hidden;
  background:radial-gradient(120% 100% at 50% 0%,#1a1840 0%,#0a0820 55%,#05030f 100%);
  border:1px solid rgba(168,85,247,.2); box-shadow:inset 0 0 60px rgba(34,211,238,.07),0 20px 60px rgba(0,0,0,.6); }
@media(max-width:480px){ .stage { height:72vw; min-height:240px; border-radius:16px; } }
.status-pill { position:absolute; bottom:10px; left:50%; transform:translateX(-50%); font-size:11px; color:#a5f3fc;
  background:rgba(0,0,0,.5); border:1px solid rgba(34,211,238,.3); padding:3px 12px; border-radius:999px;
  backdrop-filter:blur(8px); white-space:nowrap; pointer-events:none; }
.transcript { width:100%; max-width:640px; max-height:180px; overflow-y:auto; display:flex; flex-direction:column; gap:8px;
  padding:10px 12px; background:rgba(0,0,0,.3); border-radius:0 0 16px 16px;
  border:1px solid rgba(255,255,255,.07); border-top:none; scroll-behavior:smooth; }
@media(max-width:480px){ .transcript { max-height:140px; padding:8px 10px; } }
.transcript::-webkit-scrollbar { width:3px; }
.transcript::-webkit-scrollbar-track { background:rgba(255,255,255,.04); }
.transcript::-webkit-scrollbar-thumb { background:rgba(168,85,247,.4); border-radius:4px; }
.tmsg { display:flex; flex-direction:column; gap:3px; max-width:90%; }
.tmsg-user { align-self:flex-end; align-items:flex-end; }
.tmsg-assistant { align-self:flex-start; align-items:flex-start; }
.tmsg-label { font-size:9px; font-weight:600; color:#a78bfa; padding:0 4px; letter-spacing:.5px; }
.tmsg-bubble { font-size:13px; line-height:1.5; padding:8px 12px; border-radius:14px; word-break:break-word; }
@media(max-width:480px){ .tmsg-bubble { font-size:12px; padding:7px 10px; } }
.tmsg-user .tmsg-bubble { background:rgba(139,92,246,.25); color:#e2d8ff; border-bottom-right-radius:4px; }
.tmsg-assistant .tmsg-bubble { background:rgba(255,255,255,.07); color:#e8e8f0; border-bottom-left-radius:4px; }
.chat-link { color:#38bdf8; text-decoration:underline; word-break:break-all; cursor:pointer; }
.chat-link:hover { color:#7dd3fc; }
.dots { display:inline-flex; gap:5px; align-items:center; padding:4px 0; }
.dots span { width:7px; height:7px; border-radius:50%; background:#a78bfa; animation:dotPulse 1.2s ease-in-out infinite; }
.dots span:nth-child(2) { animation-delay:.2s; }
.dots span:nth-child(3) { animation-delay:.4s; }
@keyframes dotPulse { 0%,80%,100%{transform:scale(0.7);opacity:.5} 40%{transform:scale(1);opacity:1} }
.controls { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:8px; width:100%; max-width:640px; }
.btn { padding:9px 20px; border-radius:999px; font-size:13px; font-weight:600; background:linear-gradient(135deg,#8b5cf6,#06b6d4);
  color:#fff; border:none; cursor:pointer; transition:.2s; box-shadow:0 4px 20px rgba(139,92,246,.4); }
.btn:hover { opacity:.9; transform:scale(1.03); }
.btn.stop { background:linear-gradient(135deg,#dc2626,#ef4444); box-shadow:0 4px 20px rgba(220,38,38,.4); }
.btn:disabled { opacity:.4; cursor:not-allowed; transform:none; }
.seg { display:flex; gap:3px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:999px; padding:3px; flex-wrap:nowrap; overflow:hidden; }
.seg-btn { padding:5px 9px; border-radius:999px; font-size:12px; color:#cbd5e1; transition:.2s; background:none; border:none; cursor:pointer; white-space:nowrap; }
.seg-btn.on { background:rgba(34,211,238,.22); color:#fff; }
.seg-btn:hover { color:#fff; }
.settings { display:flex; flex-direction:column; align-items:center; gap:8px; width:100%; max-width:640px; }
.vsel { background:rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.15); color:#fff; border-radius:8px; padding:4px 8px; font-size:12px; max-width:140px; }
.hint { font-size:11px; color:#94a3b8; text-align:center; max-width:380px; margin:0; }
.error-banner { display:flex; align-items:center; gap:8px; background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.4);
  color:#fca5a5; padding:10px 14px; border-radius:12px; font-size:12px; max-width:640px; width:100%; }
.error-close { margin-left:auto; background:none; border:none; color:#fca5a5; font-size:16px; cursor:pointer; padding:0 4px; }
`;
