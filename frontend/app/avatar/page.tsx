"use client";
import { useEffect, useRef, useState } from "react";
import { streamChat } from "@/lib/api";
import { MATA_PERSONA, SEARCH_RULE } from "@/services/persona";
import { browserLang, detectLang, GREETINGS, Lang, speechLocale } from "@/services/lang";
import { autoExtractMemory, captureFromText, memoryPrompt, slidingWindow } from "@/services/memory";

const BASE_PERSONA = `${MATA_PERSONA} ${SEARCH_RULE}`;

// Emotion / talk modes — change BOTH the wording style and the voice.
const MOODS: Record<string, { label: string; emoji: string; style: string; rate: number; pitch: number }> = {
  humano: { label: "Humano", emoji: "🙂", style: "Habla relajada y natural, como una amiga de confianza.", rate: 1.0, pitch: 1.0 },
  feliz: { label: "Feliz", emoji: "😄", style: "Habla con mucha energía, alegre y entusiasta, transmite optimismo y buen humor.", rate: 1.12, pitch: 1.2 },
  serio: { label: "Serio", emoji: "🧐", style: "Habla calmada, profesional y concisa, con tono formal y seguro.", rate: 0.93, pitch: 0.85 },
  creativo: { label: "Creativo", emoji: "🎨", style: "Habla imaginativa, juguetona y expresiva, con metáforas y un toque artístico.", rate: 1.04, pitch: 1.08 },
};

const LANG_NAMES: Record<Lang, string> = {
  es: "español", en: "inglés", fr: "francés", it: "italiano", pt: "portugués", de: "alemán",
};

// Heuristics to guess voice gender by name (the Web Speech API doesn't expose it).
const MALE_HINTS =
  /(pablo|jorge|alvaro|álvaro|raul|raúl|diego|enrique|miguel|carlos|juan|andres|andrés|jose|josé|fernando|gonzalo|david|mark|guy|christopher|eric|brandon|liam|james|paul|thomas|henri|nicolas|matteo|giorgio|bruno|joao|joão|jens|hans|stefan|conrad|male|hombre|masculino|\bman\b)/i;
const FEMALE_HINTS =
  /(sabina|helena|laura|elena|paulina|monica|mónica|dalia|lucia|lucía|maria|maría|samantha|zira|aria|jenny|female|mujer|woman|google)/i;

// Cloud TTS via Google Translate — real native pronunciation, works on any device.
// One neutral voice per language (no gender choice). For a male voice use device voices in Edge.
function cloudTtsUrl(lang: Lang, text: string): string {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text.slice(0, 200))}`;
}

// Split text into <=200-char chunks at word boundaries (Google TTS limit).
function chunkText(text: string, max = 200): string[] {
  if (text.length <= max) return [text];
  const words = text.split(" ");
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) out.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) out.push(cur.trim());
  return out;
}
const LANG_OPTS: { key: "auto" | Lang; label: string }[] = [
  { key: "auto", label: "🌐 Auto" },
  { key: "es", label: "🇪🇸 ES" },
  { key: "en", label: "🇬🇧 EN" },
  { key: "fr", label: "🇫🇷 FR" },
  { key: "it", label: "🇮🇹 IT" },
  { key: "pt", label: "🇵🇹 PT" },
  { key: "de", label: "🇩🇪 DE" },
];

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
  const [langMode, setLangMode] = useState<"auto" | Lang>("es"); // default Spanish
  const [gender, setGender] = useState<"male" | "female">("male"); // default male voice
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [voicesState, setVoicesState] = useState<SpeechSynthesisVoice[]>([]);
  const [engine, setEngine] = useState<"cloud" | "device">("cloud"); // cloud = real neural voices
  const [cloudVoice, setCloudVoice] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const convoRef = useRef<{ role: string; content: string }[]>([]); // user/assistant only
  const convIdRef = useRef<string | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const conversingRef = useRef(false);
  const speakingRef = useRef(false);
  const spokenTextRef = useRef("");
  const moodRef = useRef("humano");
  const utterCountRef = useRef(0);
  const langRef = useRef<Lang>("es"); // effective conversation language
  const langModeRef = useRef<"auto" | Lang>("es");
  const genderRef = useRef<"male" | "female">("male");
  const manualVoiceRef = useRef<string>(""); // user-picked device voiceURI
  const engineRef = useRef<"cloud" | "device">("cloud");
  const cloudVoiceRef = useRef<string>("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const kickedRef = useRef(false); // ensures auto-start fires only once

  useEffect(() => {
    engineRef.current = engine;
    if (typeof window !== "undefined") localStorage.setItem("mata_voice_engine", engine);
  }, [engine]);
  useEffect(() => {
    cloudVoiceRef.current = cloudVoice;
    if (typeof window !== "undefined") localStorage.setItem("mata_cloud_voice", cloudVoice);
  }, [cloudVoice]);

  useEffect(() => {
    genderRef.current = gender;
    if (typeof window !== "undefined") localStorage.setItem("mata_voice_gender", gender);
  }, [gender]);

  useEffect(() => {
    manualVoiceRef.current = voiceURI;
    if (typeof window !== "undefined") localStorage.setItem("mata_voice_uri", voiceURI);
  }, [voiceURI]);

  // Load saved voice preferences once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const g = localStorage.getItem("mata_voice_gender");
    if (g === "male" || g === "female") setGender(g);
    const v = localStorage.getItem("mata_voice_uri");
    if (v) setVoiceURI(v);
    const e = localStorage.getItem("mata_voice_engine");
    if (e === "cloud" || e === "device") setEngine(e);
    const cv = localStorage.getItem("mata_cloud_voice");
    if (cv) setCloudVoice(cv);
  }, []);


  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  // Apply the chosen language: fixes recognition locale + voice + reply language.
  useEffect(() => {
    langModeRef.current = langMode;
    langRef.current = langMode === "auto" ? browserLang() : langMode;
    if (conversingRef.current) {
      try { recognitionRef.current?.abort(); } catch {}
      setTimeout(() => startListening(), 200); // restart STT in the new locale
    }
  }, [langMode]);

  // Best voice for a language: manual pick first, then gender preference, then any match.
  function pickVoiceFor(lang: Lang): SpeechSynthesisVoice | null {
    const all = voicesRef.current.length ? voicesRef.current : window.speechSynthesis.getVoices();
    const m = all.filter((v) => v.lang.toLowerCase().startsWith(lang));
    if (manualVoiceRef.current) {
      const picked = m.find((v) => v.voiceURI === manualVoiceRef.current);
      if (picked) return picked;
    }
    if (!m.length) return all[0] || null; // no voice for this language installed
    const wanted = genderRef.current === "male" ? MALE_HINTS : FEMALE_HINTS;
    const avoid = genderRef.current === "male" ? FEMALE_HINTS : MALE_HINTS;
    return (
      m.find((v) => wanted.test(v.name) && /natural|neural|online/i.test(v.name)) ||
      m.find((v) => wanted.test(v.name)) ||
      m.find((v) => !avoid.test(v.name) && /natural|neural|online/i.test(v.name)) ||
      m.find((v) => !avoid.test(v.name)) ||
      m[0]
    );
  }

  function previewVoice() {
    const lang = langModeRef.current === "auto" ? browserLang() : langModeRef.current;
    const samples: Record<Lang, string> = {
      es: "Hola, soy Mata. Así sonará mi voz.",
      en: "Hi, I'm Mata. This is how my voice sounds.",
      fr: "Salut, je suis Mata. Voici ma voix.",
      it: "Ciao, sono Mata. Ecco la mia voce.",
      pt: "Olá, eu sou a Mata. É assim que soa minha voz.",
      de: "Hallo, ich bin Mata. So klingt meine Stimme.",
    };
    stopSpeaking();
    enqueueSpeak(samples[lang]);
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
      const vs = window.speechSynthesis.getVoices();
      voicesRef.current = vs;
      setVoicesState(vs);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      conversingRef.current = false;
      try { rec.abort(); } catch {}
      window.speechSynthesis.cancel();
    };
  }, []);

  // Auto-start the conversation as soon as you enter the page. Browsers block audio/mic
  // until a user gesture, so: if the page already had a gesture (e.g. you clicked the nav
  // link to get here) we start immediately; otherwise we start on your first click/tap.
  useEffect(() => {
    if (!supported) return;
    const kick = () => {
      if (kickedRef.current) return;
      kickedRef.current = true;
      cleanup();
      startConversation();
    };
    const onGesture = () => kick();
    const cleanup = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    // Sticky user activation carries across the in-app navigation → start right away.
    const ua: any = typeof navigator !== "undefined" ? (navigator as any).userActivation : null;
    const t = setTimeout(() => {
      if (!ua || ua.hasBeenActive) kick();
    }, 350);
    return () => {
      clearTimeout(t);
      cleanup();
    };
  }, [supported]);

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
    audioQueueRef.current = [];
    if (audioElRef.current) {
      audioElRef.current.onended = null;
      audioElRef.current.pause();
      audioElRef.current = null;
    }
    utterCountRef.current = 0;
    setSpeaking(false);
    speakingRef.current = false;
  }

  function onSpeakStart() {
    setSpeaking(true);
    speakingRef.current = true;
    setStatus("Mata está hablando… (interrúmpela cuando quieras)");
  }
  function onSpeakIdle() {
    setSpeaking(false);
    speakingRef.current = false;
    setStatus("Te escucho…");
  }

  // Speak one sentence on the device (browser TTS) — used directly or as cloud fallback.
  function deviceSpeak(text: string, onDone?: () => void) {
    const m = MOODS[moodRef.current];
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoiceFor(langRef.current);
    if (v) u.voice = v;
    u.lang = speechLocale(langRef.current);
    u.rate = m.rate;
    u.pitch = m.pitch;
    u.onstart = onSpeakStart;
    u.onend = () => {
      utterCountRef.current = Math.max(0, utterCountRef.current - 1);
      if (utterCountRef.current === 0) onSpeakIdle();
      onDone?.();
    };
    utterCountRef.current += 1;
    window.speechSynthesis.speak(u);
  }

  // Play the cloud (neural) audio queue sentence by sentence.
  function playNextCloud() {
    const text = audioQueueRef.current.shift();
    if (!text) {
      onSpeakIdle();
      return;
    }
    const url = cloudTtsUrl(langRef.current, text);
    const audio = new Audio(url);
    audioElRef.current = audio;
    onSpeakStart();
    audio.onended = () => {
      audioElRef.current = null;
      playNextCloud();
    };
    audio.onerror = () => {
      audioElRef.current = null;
      deviceSpeak(text, () => playNextCloud()); // fallback to device voice
    };
    audio.play().catch(() => {
      audioElRef.current = null;
      deviceSpeak(text, () => playNextCloud());
    });
  }

  // Queue a sentence to be spoken (cloud neural voice by default; device as fallback).
  function enqueueSpeak(sentence: string) {
    const clean = stripForSpeech(sentence);
    if (!clean) return;
    spokenTextRef.current += " " + clean.toLowerCase();
    if (engineRef.current === "cloud") {
      for (const part of chunkText(clean)) audioQueueRef.current.push(part);
      if (!audioElRef.current) playNextCloud();
    } else {
      deviceSpeak(clean);
    }
  }

  function systemMessage() {
    const replyLang = `IMPORTANTE: responde SIEMPRE en ${LANG_NAMES[langRef.current]}, sin importar nada más.`;
    const parts = [BASE_PERSONA, replyLang, `Estado de ánimo actual: ${MOODS[moodRef.current].style}`, memoryPrompt()];
    return { role: "system", content: parts.filter(Boolean).join(" ") };
  }

  async function handleUtterance(text: string) {
    // Language: respect the explicit choice; only auto-detect when mode is "auto".
    langRef.current = langModeRef.current === "auto" ? detectLang(text, langRef.current) : langModeRef.current;
    const explicit = captureFromText(text); // explicit "recuerda que…"
    if (!explicit) autoExtractMemory(text); // background auto-memory (fire-and-forget)
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
      const messages = [systemMessage(), ...slidingWindow(convoRef.current, 24)];
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
    langRef.current = langModeRef.current === "auto" ? browserLang() : langModeRef.current;
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
  const effLang: Lang = langMode === "auto" ? browserLang() : langMode;
  const voicesForLang = voicesState.filter((v) => v.lang.toLowerCase().startsWith(effLang));

  return (
    <div className="flex flex-col items-center">
      <style>{robotCss}</style>
      <h1 className="mb-1 text-2xl font-bold">Mata · Asistente en vivo</h1>
      <p className="mb-4 text-center text-sm text-zinc-400">
        Mata te saluda al entrar y conversas por voz · te recuerda · interrúmpela cuando quieras · pídele que te busque cosas.
      </p>

      {/* Language selector */}
      <div className="mb-3 flex flex-wrap justify-center gap-2">
        {LANG_OPTS.map((o) => (
          <button
            key={o.key}
            onClick={() => setLangMode(o.key)}
            className={`rounded-full border px-3 py-1 text-xs transition ${langMode === o.key ? "border-emerald-400 bg-emerald-400/20 text-white" : "border-white/15 text-zinc-300"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Voice engine toggle */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => setEngine("cloud")}
          className={`rounded-full border px-3 py-1 text-xs transition ${engine === "cloud" ? "border-emerald-400 bg-emerald-400/20 text-white" : "border-white/15 text-zinc-300"}`}
        >
          🌟 Voz natural (nube)
        </button>
        <button
          onClick={() => setEngine("device")}
          className={`rounded-full border px-3 py-1 text-xs transition ${engine === "device" ? "border-emerald-400 bg-emerald-400/20 text-white" : "border-white/15 text-zinc-300"}`}
        >
          💻 Voz del dispositivo
        </button>
      </div>

      {/* Voice selector */}
      <div className="mb-2 flex flex-wrap items-center justify-center gap-2">
        {engine === "device" && (
          <>
            <button
              onClick={() => setGender("male")}
              className={`rounded-full border px-3 py-1 text-xs transition ${gender === "male" ? "border-cyan-400 bg-cyan-400/20 text-white" : "border-white/15 text-zinc-300"}`}
            >
              👨 Hombre
            </button>
            <button
              onClick={() => setGender("female")}
              className={`rounded-full border px-3 py-1 text-xs transition ${gender === "female" ? "border-cyan-400 bg-cyan-400/20 text-white" : "border-white/15 text-zinc-300"}`}
            >
              👩 Mujer
            </button>
            <select
              value={voiceURI}
              onChange={(e) => setVoiceURI(e.target.value)}
              className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-xs text-white outline-none"
              title="Elige la voz exacta"
            >
              <option value="">Voz automática ({gender === "male" ? "hombre" : "mujer"})</option>
              {voicesForLang.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button onClick={previewVoice} className="rounded-full border border-white/15 px-3 py-1 text-xs text-zinc-200 hover:bg-white/10">
          🔊 Probar voz
        </button>
      </div>
      {engine === "cloud" && (
        <p className="mb-3 max-w-md text-center text-xs text-emerald-400/80">
          🌟 Voz neural en la nube — <b>{LANG_NAMES[effLang]} real</b>, funciona en cualquier dispositivo. (Voz neutral; para voz de <b>hombre</b> usa “💻 Voz del dispositivo” en Microsoft Edge.)
        </p>
      )}
      {engine === "device" && voicesForLang.length === 0 && (
        <p className="mb-3 max-w-md text-center text-xs text-amber-400">
          ⚠️ Tu dispositivo no tiene voces en {LANG_NAMES[effLang]}. Cambia a <b>🌟 Voz natural (nube)</b>, o abre el sitio en <b>Microsoft Edge</b> y elige una voz “(Natural)”.
        </p>
      )}

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

      {conversing ? (
        <button onClick={stopConversation} className="btn mt-3 !bg-red-600">■ Terminar conversación</button>
      ) : (
        <button onClick={startConversation} disabled={!supported} className="btn mt-3">▶ Reanudar conversación</button>
      )}

      {conversing && <p className="mt-2 text-xs text-emerald-400">● En vivo — habla cuando quieras, incluso mientras ella habla</p>}
      <p className="mt-1 text-xs text-zinc-500">💡 Mata te habla al entrar. Usa audífonos para interrumpir mejor (evita el eco).</p>

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
