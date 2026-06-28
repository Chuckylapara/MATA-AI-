const EL_KEY   = process.env.NEXT_PUBLIC_ELEVENLABS_KEY  || "";
const EL_VOICE = process.env.NEXT_PUBLIC_ELEVENLABS_VOICE || "";

export function isElevenLabsReady() {
  return !!(EL_KEY && EL_VOICE);
}

/**
 * Llama a ElevenLabs TTS y devuelve una URL object: de audio MP3.
 * Hay que llamar URL.revokeObjectURL(url) cuando termines de reproducirlo.
 */
export async function elevenLabsSpeak(text: string): Promise<string> {
  if (!EL_KEY || !EL_VOICE) throw new Error("ElevenLabs no configurado");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${EL_VOICE}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": EL_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.82,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.detail?.message || `ElevenLabs error ${res.status}`);
  }

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
