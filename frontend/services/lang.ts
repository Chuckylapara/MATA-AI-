// Lightweight language auto-detection for the 6 supported languages.
// Used to switch speech-recognition locale and the text-to-speech voice automatically.

export type Lang = "es" | "en" | "fr" | "it" | "pt" | "de";

const SPEECH: Record<Lang, string> = {
  es: "es-ES",
  en: "en-US",
  fr: "fr-FR",
  it: "it-IT",
  pt: "pt-BR",
  de: "de-DE",
};

export function speechLocale(l: Lang): string {
  return SPEECH[l];
}

export function browserLang(): Lang {
  if (typeof navigator === "undefined") return "es";
  const code = (navigator.language || "es").slice(0, 2).toLowerCase();
  return (["es", "en", "fr", "it", "pt", "de"].includes(code) ? code : "es") as Lang;
}

// Common-word markers per language (word-boundary matched).
const MARKERS: Record<Lang, RegExp[]> = {
  es: [/\b(el|la|que|de|los|una|cómo|qué|hola|gracias|está|porque|tú|yo|muy|pero)\b/g, /[ñ¿¡]/g],
  en: [/\b(the|you|is|what|how|hello|thanks|and|with|please|this|that|are|do)\b/g],
  fr: [/\b(le|la|je|tu|est|vous|bonjour|merci|une|qui|pour|avec|c'est|oui|pas)\b/g, /[çœà]/g],
  it: [/\b(che|sono|ciao|grazie|per|il|una|come|sei|molto|però|anche|questo)\b/g],
  pt: [/\b(você|obrigado|não|está|eu|uma|com|são|porque|muito|isso|para|olá)\b/g, /[ãõç]/g],
  de: [/\b(der|die|das|und|ich|nicht|ist|ein|eine|hallo|danke|mit|wie|was|sehr)\b/g, /[ßäöü]/g],
};

export function detectLang(text: string, fallback: Lang = "es"): Lang {
  const t = ` ${text.toLowerCase()} `;
  if (t.trim().length < 2) return fallback;
  let best: Lang = fallback;
  let bestScore = 0;
  (Object.keys(MARKERS) as Lang[]).forEach((lang) => {
    let score = 0;
    for (const re of MARKERS[lang]) score += (t.match(re) || []).length;
    if (score > bestScore) {
      bestScore = score;
      best = lang;
    }
  });
  return bestScore === 0 ? fallback : best;
}

export const GREETINGS: Record<Lang, string> = {
  es: "¡Hola! ¿Cómo puedo ayudarte? Yo soy Mata AI.",
  en: "Hi! How can I help you? I'm Mata AI.",
  fr: "Bonjour ! Comment puis-je t'aider ? Je suis Mata AI.",
  it: "Ciao! Come posso aiutarti? Sono Mata AI.",
  pt: "Olá! Como posso te ajudar? Eu sou a Mata AI.",
  de: "Hallo! Wie kann ich dir helfen? Ich bin Mata AI.",
};
