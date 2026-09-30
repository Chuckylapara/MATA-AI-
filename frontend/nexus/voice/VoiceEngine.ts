"use client";
// NEXUS voice loop (Phase 4a): mic → VAD → streaming STT → [server] → streaming TTS → lip-sync.
//
// Providers: the browser's Web Speech API (SpeechRecognition + speechSynthesis). It is
// free and needs no install, but: Chrome/Edge send audio to the vendor's cloud for
// recognition, Firefox has no SpeechRecognition, and real TTS audio amplitude is not
// exposed — lip-sync is driven by word-boundary events. Phase 4b swaps in Silero VAD +
// Whisper + Kokoro behind the same class (see docs/nexus/VOICE.md).
import { bus } from "@/nexus/core/bus";

export interface VoiceCallbacks {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onMicLevel?: (level: number) => void;
  onSpeechLevel?: (level: number) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (message: string) => void;
  onListeningChange?: (listening: boolean) => void;
}

export interface VoiceSupport { stt: boolean; tts: boolean; mic: boolean }

const STOP_WORDS = /^(espera|para|stop|wait|un momento|calla|cállate|silencio|hold on|pause|detente|ya)[.!¡¿?\s]*$/i;

export function voiceSupport(): VoiceSupport {
  if (typeof window === "undefined") return { stt: false, tts: false, mic: false };
  const w = window as any;
  return {
    stt: !!(w.SpeechRecognition || w.webkitSpeechRecognition),
    tts: "speechSynthesis" in window,
    mic: !!navigator.mediaDevices?.getUserMedia,
  };
}

export class VoiceEngine {
  lang = "es-ES";
  voiceURI: string | null = null;
  rate = 1.02;
  pitch = 1.0;
  deviceId: string | null = null;
  /** True while the user has the microphone switched on. */
  micOn = false;

  private rec: any = null;
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelRaf = 0;
  private queue: string[] = [];
  private pendingText = "";
  private speaking = false;
  private currentUtter: string = "";
  private speechLevel = 0;
  private speechRaf = 0;
  private vadHot = 0;
  private noiseFloor = 0.02;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private cb: VoiceCallbacks = {}) {}

  // ------------------------------------------------------------------ microphone + STT
  async startListening(): Promise<boolean> {
    const sup = voiceSupport();
    if (!sup.mic) { this.cb.onError?.("Microphone API not available in this browser."); return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: this.deviceId ? { exact: this.deviceId } : undefined, echoCancellation: true,
                 noiseSuppression: true, autoGainControl: true },
      });
    } catch (e: any) {
      this.cb.onError?.(e?.name === "NotAllowedError" ? "Microphone permission denied." : `Microphone error: ${e?.message || e}`);
      return false;
    }
    this.micOn = true;
    this.audioCtx = new AudioContext();
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.levelLoop();

    if (sup.stt) this.startRecognition();
    else this.cb.onError?.("Speech recognition is not supported in this browser (try Chrome, Edge or Safari). You can still type.");
    bus.emit("MIC_ENABLED");
    this.cb.onListeningChange?.(true);
    return true;
  }

  stopListening() {
    this.micOn = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try { this.rec?.abort(); } catch { /* noop */ }
    this.rec = null;
    cancelAnimationFrame(this.levelRaf);
    this.stream?.getTracks().forEach((t) => t.stop());   // hardware off, indicator off
    this.stream = null;
    this.audioCtx?.close().catch(() => null);
    this.audioCtx = null;
    this.analyser = null;
    this.cb.onMicLevel?.(0);
    bus.emit("MIC_DISABLED");
    this.cb.onListeningChange?.(false);
  }

  private startRecognition() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const txt = r[0].transcript.trim();
        if (!txt) continue;
        if (r.isFinal) {
          if (this.isEcho(txt)) continue;           // our own TTS picked up by the mic
          this.handleFinal(txt);
        } else {
          interim += txt + " ";
        }
      }
      interim = interim.trim();
      if (interim && !this.isEcho(interim)) {
        this.cb.onInterim?.(interim);
        if (this.speaking && interim.split(/\s+/).length >= 2) this.interrupt("speech");
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.cb.onError?.("Speech recognition permission denied.");
        this.micOn = false;
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        this.cb.onError?.(`Speech recognition error: ${e.error}`);
      }
    };
    rec.onend = () => {
      // Browsers stop recognition periodically; restart while the mic is on.
      if (this.micOn) this.restartTimer = setTimeout(() => { try { rec.start(); } catch { /* already */ } }, 250);
    };
    this.rec = rec;
    try { rec.start(); } catch { /* noop */ }
  }

  private handleFinal(txt: string) {
    if (this.speaking) this.interrupt("speech");
    this.cb.onFinal?.(txt);
  }

  /** Heuristic echo rejection: interim text that mostly repeats what NEXUS is saying. */
  private isEcho(txt: string) {
    if (!this.speaking || !this.currentUtter) return false;
    const said = new Set(this.normalize(this.currentUtter + " " + this.queue.join(" ")).split(" "));
    const words = this.normalize(txt).split(" ").filter(Boolean);
    if (!words.length) return true;
    const overlap = words.filter((w) => said.has(w)).length / words.length;
    return overlap >= 0.7;
  }

  private normalize(s: string) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  static isStopCommand(text: string) { return STOP_WORDS.test(text.trim()); }

  private levelLoop = () => {
    this.levelRaf = requestAnimationFrame(this.levelLoop);
    if (!this.analyser) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    // adaptive noise floor (slowly tracks ambient level when quiet)
    if (rms < this.noiseFloor * 2) this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;
    const level = Math.min(1, Math.max(0, (rms - this.noiseFloor) * 12));
    this.cb.onMicLevel?.(level);
    // Energy VAD for barge-in: louder threshold while NEXUS speaks (echo margin), sustained ~200 ms.
    const threshold = this.speaking ? 0.45 : 0.18;
    this.vadHot = level > threshold ? this.vadHot + 1 : Math.max(0, this.vadHot - 2);
    if (this.speaking && this.vadHot > 12) { this.vadHot = 0; this.interrupt("vad"); }
  };

  // ------------------------------------------------------------------ TTS (streaming)
  voices(): SpeechSynthesisVoice[] {
    return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis.getVoices() : [];
  }

  /** Feed streamed tokens; complete sentences are spoken as soon as they are available. */
  pushText(chunk: string) {
    this.pendingText += chunk;
    const re = /([^.!?¡¿\n]+[.!?]+|[^\n]+\n)/g;
    let m: RegExpExecArray | null;
    let consumed = 0;
    while ((m = re.exec(this.pendingText))) {
      const s = clean(m[0]);
      if (s) this.enqueue(s);
      consumed = re.lastIndex;
    }
    this.pendingText = this.pendingText.slice(consumed);
  }

  /** Flush the remaining partial sentence at the end of a streamed reply. */
  flush() {
    const s = clean(this.pendingText);
    this.pendingText = "";
    if (s) this.enqueue(s);
  }

  say(text: string) { this.pushText(text); this.flush(); }

  private enqueue(sentence: string) {
    this.queue.push(sentence);
    if (!this.speaking) this.next();
  }

  private next() {
    if (!("speechSynthesis" in window)) return;
    const sentence = this.queue.shift();
    if (!sentence) { this.setSpeaking(false); return; }
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = this.lang;
    u.rate = this.rate;
    u.pitch = this.pitch;
    const v = this.pickVoice();
    if (v) u.voice = v;
    this.currentUtter = sentence;
    u.onstart = () => this.setSpeaking(true);
    u.onboundary = () => { this.speechLevel = 1; };   // word onset → mouth opens
    u.onend = () => { this.currentUtter = ""; setTimeout(() => this.next(), 90); };  // natural pause
    u.onerror = () => { this.currentUtter = ""; this.next(); };
    window.speechSynthesis.speak(u);
    this.setSpeaking(true);
  }

  private pickVoice(): SpeechSynthesisVoice | null {
    const all = this.voices();
    if (this.voiceURI) {
      const v = all.find((x) => x.voiceURI === this.voiceURI);
      if (v) return v;
    }
    const base = this.lang.slice(0, 2);
    return all.find((x) => x.lang.startsWith(base) && /natural|neural|google|premium/i.test(x.name))
      || all.find((x) => x.lang.startsWith(base)) || null;
  }

  private setSpeaking(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.cb.onSpeakingChange?.(on);
    cancelAnimationFrame(this.speechRaf);
    if (on) {
      const tick = () => {
        // Synthetic envelope: boundary pulses decay, plus syllable-rate modulation.
        this.speechLevel *= 0.9;
        const syll = 0.35 + 0.25 * Math.abs(Math.sin(performance.now() / 70));
        this.cb.onSpeechLevel?.(Math.min(1, this.speechLevel * 0.7 + syll * 0.5));
        this.speechRaf = requestAnimationFrame(tick);
      };
      tick();
    } else {
      this.cb.onSpeechLevel?.(0);
    }
  }

  get isSpeaking() { return this.speaking; }

  /** Stop talking immediately (barge-in or user action). */
  interrupt(reason: "speech" | "vad" | "user" = "user") {
    if (!this.speaking && !this.queue.length) return;
    this.queue = [];
    this.pendingText = "";
    this.currentUtter = "";
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    this.setSpeaking(false);
    bus.emit("USER_INTERRUPTED", { reason });
  }

  async inputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  }

  dispose() { this.interrupt(); this.stopListening(); }
}

function clean(s: string) {
  return s.replace(/https?:\/\/\S+/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#>|]/g, "")
    .replace(/\s{2,}/g, " ").trim();
}
