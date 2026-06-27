"use client";
import { useEffect, useState } from "react";

// Speaks "Welcome to Mata AI" once per session. Browsers block speech until a user
// gesture, so we try immediately and also on the first interaction as a fallback.
export default function WelcomeVoice() {
  const [needsTap, setNeedsTap] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (sessionStorage.getItem("mata_welcomed") === "1") return;

    let done = false;

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      return (
        voices.find((v) => v.lang.startsWith("en") && /google|samantha|zira|aria|jenny|female/i.test(v.name)) ||
        voices.find((v) => v.lang.startsWith("en")) ||
        voices[0] ||
        null
      );
    };

    const speak = () => {
      if (done) return;
      const u = new SpeechSynthesisUtterance("Welcome to Mata AI");
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = "en-US";
      u.rate = 0.95;
      u.pitch = 1.05;
      u.onstart = () => {
        done = true;
        sessionStorage.setItem("mata_welcomed", "1");
        setNeedsTap(false);
        cleanup();
      };
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    };

    const onGesture = () => speak();
    const cleanup = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };

    // Voices may load async.
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = () => {
        // try once voices are ready
        if (!done) speak();
      };
    }

    // Attempt immediately; if blocked (no gesture yet), wait for first interaction.
    speak();
    const t = setTimeout(() => {
      if (!done) setNeedsTap(true);
    }, 600);
    window.addEventListener("pointerdown", onGesture, { once: false });
    window.addEventListener("keydown", onGesture, { once: false });

    return () => {
      clearTimeout(t);
      cleanup();
    };
  }, []);

  if (!needsTap) return null;
  return (
    <div
      className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 animate-pulse rounded-full border border-cyan-400/40 bg-black/60 px-4 py-2 text-xs text-cyan-200 backdrop-blur"
      style={{ pointerEvents: "none" }}
    >
      🔊 Toca la pantalla para activar la voz de bienvenida
    </div>
  );
}
