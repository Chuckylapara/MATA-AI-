# NEXUS — Voice

**Status: working (Phase 4a, browser speech).** Code: `frontend/nexus/voice/VoiceEngine.ts`.

```
mic (getUserMedia: echoCancellation, noiseSuppression, AGC)
  → level meter + adaptive-noise-floor energy VAD
  → SpeechRecognition (continuous, interim results, auto-restart)
  → final transcript → POST /nexus/converse (SSE)
  → tokens → sentence splitter → speechSynthesis queue (speaks while text still streams)
  → word-boundary events → speech envelope → avatar mouth + core pulse
```

## Interruption (barge-in)
- Speaking while NEXUS talks stops it immediately: ≥2 interim words **or** sustained mic energy
  above a raised threshold (~200 ms).
- Echo rejection: transcripts that mostly repeat what NEXUS is currently saying are ignored.
- "Espera", "para", "stop", "wait", "un momento"… are handled locally: NEXUS stops and says
  "¿Sí?" / "Yes?" with no server round-trip. **Esc** or the STOP button also interrupts.

## Settings
Language, voice, speaking rate, microphone device, "speak replies aloud" (Settings panel).

## Known limitations (honest)
- Chrome/Edge perform recognition in the vendor's cloud; Firefox has no SpeechRecognition.
- Browsers don't expose TTS audio, so lip-sync uses word boundaries + syllable-rate modulation
  rather than true amplitude/visemes.
- `speechSynthesis` is not routed through WebRTC echo cancellation; the heuristics above reduce
  but cannot fully eliminate self-interruption on loud speakers. Headphones are best.

## Phase 4b (planned) — local, private pipeline
Silero VAD (`@ricky0123/vad-web`, MIT/ISC) → Whisper (faster-whisper/whisper.cpp, MIT) via a
WebSocket audio stream → Kokoro-82M TTS (Apache-2.0) with real amplitude for lip-sync. The
`VoiceEngine` API (`startListening`, `pushText`, `flush`, `interrupt`) stays the same.
