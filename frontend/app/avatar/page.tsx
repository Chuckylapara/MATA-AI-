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
  humano: { label: "Humano", emoji: "🙂", style: "Habla relajada y natural, como una amiga de confianza.", rate: 1.0, pitch: 1.0 },
  feliz: { label: "Feliz", emoji: "😄", style: "Habla con energía, alegre y entusiasta.", rate: 1.1, pitch: 1.18 },
  serio: { label: "Serio", emoji: "🧐", style: "Habla calmada, profesional y concisa.", rate: 0.94, pitch: 0.86 },
  creativo: { label: "Creativo", emoji: "🎨", style: "Habla imaginativa, juguetona y expresiva.", rate: 1.04, pitch: 1.08 },
};

const URL_RE = /(https?:\/\/[^\s)]+)/g;
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

  useEffect(() => { moodRef.current = mood; }, [mood]);
  useEffect(() => { genderRef.current = gender; }, [gender]);
  useEffect(() => { manualVoiceRef.current = voiceURI; }, [voiceURI]);
  useEffect(() => { engineRef.current = engine; }, [engine]);
  useEffect(() => {
    langModeRef.current = langMode;
    langRef.current = langMode === "auto" ? browserLang() : langMode;
    if (conversingRef.current) { try { recognitionRef.current?.abort(); } catch {} setTimeout(() => startListening(), 200); }
  }, [langMode]);

  function pickVoiceFor(lang: Lang): SpeechSynthesisVoice | null {
    const all = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const m = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
    if (manualVoiceRef.current) {
      const p = m.find((v) => v.voiceURI === manualVoiceRef.current);
      if (p) return p;
    }
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
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e: any) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      const phrase = finalText.trim();
      if (!phrase || phrase.length < 2) return;
      const overlap = wordOverlap(spokenTextRef.current, phrase);
      if (speakingRef.current && overlap > 0.45) return;
      if (!speakingRef.current && Date.now() - lastSpeakEndRef.current < 1200 && overlap > 0.6) return;
      if (speakingRef.current) stopSpeaking();
      setSurprised(true);
      setTimeout(() => setSurprised(false), 500);
      handleUtterance(phrase);
    };
    rec.onend = () => { setListening(false); if (conversingRef.current) setTimeout(() => startListening(), 300); };
    rec.onerror = (ev: any) => {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { stopConversation(); }
    };
    recognitionRef.current = rec;
    const loadVoices = () => { const vs = window.speechSynthesis.getVoices(); voicesRef.current = vs; setVoicesState(vs); };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { conversingRef.current = false; try { rec.abort(); } catch {} window.speechSynthesis.cancel(); };
  }, []);

  useEffect(() => {
    if (!supported) return;
    const kick = () => { if (kickedRef.current) return; kickedRef.current = true; cleanup(); startConversation(); };
    const cleanup = () => { window.removeEventListener("pointerdown", kick); window.removeEventListener("keydown", kick); };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
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
    utterCountRef.current = 0;
    setSpeaking(false); speakingRef.current = false; lastSpeakEndRef.current = Date.now();
  }
  function onSpeakStart() { setSpeaking(true); speakingRef.current = true; }
  function onSpeakIdle() { setSpeaking(false); speakingRef.current = false; lastSpeakEndRef.current = Date.now(); }

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
    audioElRef.current = audio;
    onSpeakStart();
    let done = false;
    const finish = () => { if (done) return; done = true; audioElRef.current = null; playNextCloud(); };
    const fallback = () => { if (done) return; done = true; audioElRef.current = null; deviceSpeak(text, () => playNextCloud()); };
    audio.onended = finish;
    audio.onerror = fallback;
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
    setThinking(true);
    stopSpeaking();
    spokenTextRef.current = "";
    let full = "";
    let pending = "";
    let thinkingCleared = false;
    try {
      const messages = [systemMsg(), ...slidingWindow(convoRef.current, 24)];
      convIdRef.current = await streamChat(messages, convIdRef.current, (delta) => {
        if (!thinkingCleared) { thinkingCleared = true; setThinking(false); }
        full += delta; pending += delta;
        let mm: RegExpMatchArray | null;
        while ((mm = pending.match(/(.+?[.!?…\n])(\s|$)/s))) { enqueueSpeak(mm[1]); pending = pending.slice((mm.index ?? 0) + mm[0].length); }
      });
      if (pending.trim()) enqueueSpeak(pending);
      convoRef.current.push({ role: "assistant", content: full });
      setError(null);
    } catch (err: any) {
      console.error(err);
      const msg = err?.message || "";
      if (msg.includes("401") || msg.includes("403")) {
        setError("Sesión expirada. Por favor inicia sesión de nuevo.");
        stopConversation();
      } else if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError("Sin conexión al servidor. Verifica tu internet.");
      } else {
        setError(`Error al responder: ${msg}`);
      }
    } finally {
      setThinking(false);
    }
  }

  function startConversation() {
    if (!getToken()) {
      setError("Necesitas iniciar sesión para hablar con Mata. Toca 'Cuenta' arriba.");
      return;
    }
    setError(null);
    window.speechSynthesis.cancel();
    conversingRef.current = true;
    setConversing(true);
    convoRef.current = [];
    convIdRef.current = null;
    spokenTextRef.current = "";
    langRef.current = langModeRef.current === "auto" ? browserLang() : langModeRef.current;
    startListening();
    const greeting = GREETINGS[langRef.current];
    convoRef.current.push({ role: "assistant", content: greeting });
    enqueueSpeak(greeting);
  }
  function stopConversation() {
    conversingRef.current = false;
    setConversing(false); setListening(false); setThinking(false);
    stopSpeaking();
    try { recognitionRef.current?.abort(); } catch {}
  }

  const face = surprised ? "surprised" : speaking ? "speaking" : thinking ? "thinking" : listening ? "listening" : "idle";
  const effLang: Lang = langMode === "auto" ? browserLang() : langMode;
  const voicesForLang = voicesState.filter((v) => v.lang.toLowerCase().startsWith(effLang));

  return (
    <div className="avatar-page">
      <style>{faceCss}</style>

      {error && (
        <div className="error-banner">
          ⚠️ {error}
          <button onClick={() => setError(null)} className="error-close">✕</button>
        </div>
      )}

      {!supported && (
        <div className="error-banner">
          ⚠️ Tu navegador no soporta reconocimiento de voz. Prueba con Chrome en escritorio.
        </div>
      )}

      <div className={`stage ${face} mood-${mood}`}>
        <div className="aura" />
        <div className="head">
          <div className="hair" />
          <div className="face">
            <div className="brow brow-l" />
            <div className="brow brow-r" />
            <div className="eye eye-l"><span className="pupil" /><span className="lid" /></div>
            <div className="eye eye-r"><span className="pupil" /><span className="lid" /></div>
            <div className="nose" />
            <div className="mouth"><span className="lips" /></div>
          </div>
        </div>
        <div className="status-pill">
          {speaking ? "● Hablando" : thinking ? "… Pensando" : listening ? "🎙 Escuchando" : conversing ? "En vivo" : "Pausado"}
        </div>
      </div>

      <div className="controls">
        {conversing ? (
          <button onClick={stopConversation} className="btn !bg-red-600">■ Terminar</button>
        ) : (
          <button onClick={startConversation} disabled={!supported} className="btn">🎤 Hablar</button>
        )}
        <div className="seg">
          {LANG_OPTS.map((o) => (
            <button key={o.key} onClick={() => setLangMode(o.key)} className={`seg-btn ${langMode === o.key ? "on" : ""}`}>{o.label}</button>
          ))}
        </div>
        <div className="seg">
          {Object.entries(MOODS).map(([k, m]) => (
            <button key={k} onClick={() => setMood(k)} className={`seg-btn ${mood === k ? "on" : ""}`} title={m.label}>{m.emoji}</button>
          ))}
        </div>
        <button onClick={() => setShowSettings((s) => !s)} className="seg-btn">⚙️</button>
      </div>

      {showSettings && (
        <div className="settings">
          <div className="seg">
            <button onClick={() => setEngine("cloud")} className={`seg-btn ${engine === "cloud" ? "on" : ""}`}>🌟 Voz natural (nube)</button>
            <button onClick={() => setEngine("device")} className={`seg-btn ${engine === "device" ? "on" : ""}`}>💻 Dispositivo</button>
          </div>
          {engine === "device" && (
            <div className="seg">
              <button onClick={() => setGender("male")} className={`seg-btn ${gender === "male" ? "on" : ""}`}>👨</button>
              <button onClick={() => setGender("female")} className={`seg-btn ${gender === "female" ? "on" : ""}`}>👩</button>
              <select value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)} className="vsel">
                <option value="">Voz automática</option>
                {voicesForLang.map((v) => (<option key={v.voiceURI} value={v.voiceURI}>{v.name}</option>))}
              </select>
            </div>
          )}
          <p className="hint">💡 Usa audífonos para interrumpirla sin eco.</p>
        </div>
      )}
    </div>
  );
}

const faceCss = `
.avatar-page { display:flex; flex-direction:column; align-items:center; gap:18px; }
.stage { position:relative; width:100%; max-width:640px; height:60vh; min-height:420px; border-radius:28px; overflow:hidden;
  background: radial-gradient(120% 100% at 50% 0%, #1a1840 0%, #0a0820 55%, #05030f 100%);
  border:1px solid rgba(168,85,247,.25); box-shadow: inset 0 0 80px rgba(34,211,238,.12), 0 20px 60px rgba(0,0,0,.5);
  display:flex; align-items:center; justify-content:center; }
.aura { position:absolute; width:340px; height:340px; border-radius:50%; filter:blur(30px); opacity:.5;
  background: radial-gradient(circle, rgba(34,211,238,.5), transparent 70%); transition:background .4s, opacity .4s; }
.stage.speaking .aura { background: radial-gradient(circle, rgba(16,185,129,.55), transparent 70%); opacity:.8; }
.stage.thinking .aura { background: radial-gradient(circle, rgba(234,179,8,.5), transparent 70%); }
.stage.listening .aura { background: radial-gradient(circle, rgba(168,85,247,.55), transparent 70%); }
.head { position:relative; width:230px; height:300px; animation: float 6s ease-in-out infinite; }
.stage.listening .head { animation: float 6s ease-in-out infinite, tilt 4s ease-in-out infinite; }
@keyframes float { 0%,100%{ transform:translateY(0);} 50%{ transform:translateY(-10px);} }
@keyframes tilt { 0%,100%{ transform:rotate(-3deg);} 50%{ transform:rotate(3deg);} }
.hair { position:absolute; top:-6px; left:50%; transform:translateX(-50%); width:208px; height:130px; border-radius:50% 50% 45% 45%;
  background: linear-gradient(160deg,#3b2f63,#241b40); box-shadow:0 0 30px rgba(124,58,237,.4); }
.face { position:absolute; top:40px; left:50%; transform:translateX(-50%); width:188px; height:236px; border-radius:46% 46% 48% 48%;
  background: linear-gradient(160deg,#f1d6c0,#e3b89c); box-shadow: inset -14px -16px 30px rgba(0,0,0,.18), inset 10px 8px 24px rgba(255,255,255,.35), 0 0 30px rgba(34,211,238,.18); }
.brow { position:absolute; top:78px; width:46px; height:7px; border-radius:6px; background:#5b4636; transition: transform .25s; }
.brow-l { left:30px; } .brow-r { right:30px; }
.stage.thinking .brow-l { transform: translateY(-6px) rotate(-12deg); }
.stage.thinking .brow-r { transform: translateY(-3px) rotate(6deg); }
.stage.surprised .brow { transform: translateY(-10px); }
.mood-feliz .brow { transform: translateY(-2px) rotate(0deg); }
.eye { position:absolute; top:92px; width:46px; height:30px; border-radius:50%; background:#fff; overflow:hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,.2); }
.eye-l { left:28px; } .eye-r { right:28px; }
.pupil { position:absolute; top:7px; left:14px; width:18px; height:18px; border-radius:50%;
  background: radial-gradient(circle at 35% 35%, #2dd4bf, #0e7490 70%); transition: transform .3s; }
.stage.thinking .pupil { transform: translate(-7px,-4px); }
.stage.surprised .eye { height:38px; top:88px; }
.lid { position:absolute; inset:0; background:#e3b89c; transform-origin:top; transform:scaleY(0); animation: blink 5s infinite; }
.stage.idle .lid { animation: blink 4s infinite; }
.stage.speaking .lid { animation: blink 5.5s infinite; }
@keyframes blink { 0%,94%,100%{ transform:scaleY(0);} 97%{ transform:scaleY(1);} }
.nose { position:absolute; top:120px; left:50%; transform:translateX(-50%); width:16px; height:40px; border-radius:0 0 10px 10px;
  background: linear-gradient(90deg, rgba(0,0,0,.06), rgba(0,0,0,.14)); }
.mouth { position:absolute; bottom:36px; left:50%; transform:translateX(-50%); width:78px; height:18px; display:flex; align-items:center; justify-content:center; }
.lips { width:100%; height:10px; border-radius:0 0 40px 40px; background:#b6584f; box-shadow: inset 0 -3px 4px rgba(0,0,0,.25);
  transition: height .08s, border-radius .2s, width .2s; }
.mood-feliz .lips { border-radius:0 0 60px 60px; height:14px; }
.mood-serio .lips { border-radius:6px; height:6px; width:60%; }
.stage.thinking .lips { width:26px; height:14px; border-radius:50%; }
.stage.surprised .lips { width:34px; height:30px; border-radius:50%; }
.stage.speaking .lips { animation: talk .26s ease-in-out infinite; }
@keyframes talk { 0%{ height:6px;} 35%{ height:26px;} 70%{ height:12px;} 100%{ height:22px;} }
.status-pill { position:absolute; bottom:14px; left:50%; transform:translateX(-50%); font-size:12px; color:#a5f3fc;
  background:rgba(0,0,0,.4); border:1px solid rgba(34,211,238,.3); padding:4px 12px; border-radius:999px; backdrop-filter:blur(6px); }
.controls { display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:10px; }
.seg { display:flex; gap:4px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:999px; padding:3px; }
.seg-btn { padding:5px 10px; border-radius:999px; font-size:13px; color:#cbd5e1; transition:.2s; }
.seg-btn.on { background:rgba(34,211,238,.25); color:#fff; }
.seg-btn:hover { color:#fff; }
.settings { display:flex; flex-direction:column; align-items:center; gap:10px; }
.vsel { background:rgba(0,0,0,.5); border:1px solid rgba(255,255,255,.15); color:#fff; border-radius:8px; padding:4px 8px; font-size:12px; }
.hint { font-size:11px; color:#94a3b8; text-align:center; max-width:420px; }
.error-banner { display:flex; align-items:center; gap:8px; background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.4);
  color:#fca5a5; padding:10px 16px; border-radius:12px; font-size:13px; max-width:640px; width:100%; }
.error-close { margin-left:auto; background:none; border:none; color:#fca5a5; font-size:16px; cursor:pointer; padding:0 4px; }
`;
