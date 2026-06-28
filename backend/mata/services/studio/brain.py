"""Viral AI Studio — the orchestration brain.

Turns a one-line idea into a production-ready plan:
  analyze()    idea -> category, tone, audience, language, viral title, SEO, hashtags, thumbnail
  storyboard() idea -> visual style bible + scenes (narration, visuals, camera, emotion,
                       sound, music) each with 4 image-prompt variants for consistency.

Every function uses the shared LLM helper (Claude > Gemini) and degrades to a
deterministic mock so the product is fully usable offline / without API keys.
"""
from __future__ import annotations

import hashlib

from mata.common.llm import LLMUnavailable, active_provider, generate_json

# ---- Scene-count policy (spec §5) -------------------------------------------
# corto: 5-20 escenas · largo: 20-200 · documental: hasta 500.
_SECONDS_PER_SCENE = 8


def recommended_scene_count(target_seconds: int) -> int:
    raw = round(target_seconds / _SECONDS_PER_SCENE)
    if target_seconds <= 60:
        return max(5, min(raw, 20))
    if target_seconds <= 1800:  # up to 30 min
        return max(20, min(raw, 200))
    return max(20, min(raw, 500))  # documentary


def aspect_to_size(aspect_ratio: str) -> str:
    return {
        "9:16": "768x1344",
        "16:9": "1344x768",
        "1:1": "1024x1024",
    }.get(aspect_ratio, "1344x768")


# ---- Prompt construction ----------------------------------------------------
_ANALYZE_SYSTEM = (
    "Eres un estratega experto en contenido viral para YouTube, TikTok, Reels y Shorts. "
    "Analizas una idea y devuelves metadatos de producción listos para publicar."
)


def _analyze_prompt(idea: str) -> str:
    return f"""Analiza esta idea de video y devuelve un objeto JSON con EXACTAMENTE estas claves:

idea: "{idea}"

{{
  "idioma": "código ISO detectado de la idea (es, en, ...)",
  "categoria": "categoría temática (ej. Naturaleza, Ciencia ficción, Educación)",
  "tono": "tono narrativo (ej. épico, misterioso, divertido)",
  "audiencia": "público objetivo",
  "formato": "corto | largo",
  "duracion_recomendada_seg": número entero de segundos recomendado,
  "titulo": "título viral optimizado para clicks",
  "descripcion": "descripción SEO de 2-3 frases",
  "hashtags": ["#tag1", "#tag2", "... 5-8 hashtags"],
  "keywords": ["palabra clave 1", "... 5-8 keywords SEO"],
  "categoria_video": "categoría de plataforma (ej. Entertainment, Education)",
  "gancho": "frase gancho de los primeros 3 segundos",
  "miniatura_prompt": "prompt detallado en inglés para generar la miniatura"
}}

Responde en el mismo idioma de la idea para los campos de texto."""


_STORYBOARD_SYSTEM = (
    "Eres un director de cine y guionista profesional. Conviertes una idea en un guion "
    "cinematográfico dividido en escenas, manteniendo coherencia narrativa y consistencia "
    "visual absoluta entre escenas (mismos personajes, vestuario, edad, iluminación, paleta y estilo)."
)


def _storyboard_prompt(idea: str, analysis: dict, scenes: int, aspect_ratio: str) -> str:
    titulo = analysis.get("titulo", idea)
    tono = analysis.get("tono", "cinematográfico")
    idioma = analysis.get("idioma", "es")
    return f"""Crea un guion completo para este video.

Título: "{titulo}"
Idea: "{idea}"
Tono: {tono}
Idioma de narración: {idioma}
Relación de aspecto: {aspect_ratio}
Número de escenas: EXACTAMENTE {scenes}

Primero define una "biblia visual" para mantener consistencia, luego las escenas.
Devuelve un objeto JSON con esta forma EXACTA:

{{
  "style_guide": {{
    "personajes": "descripción persistente de personajes (apariencia, ropa, edad)",
    "paleta": "paleta de colores dominante",
    "iluminacion": "estilo de iluminación",
    "estilo_visual": "estilo global (ej. cine fotorrealista, animación 3D)",
    "ambiente": "atmósfera general"
  }},
  "escenas": [
    {{
      "numero": 1,
      "duracion_seg": número entero,
      "narracion": "texto de narración en {idioma}",
      "visual": "descripción visual de la escena",
      "movimientos": ["movimiento de cámara 1", "..."],
      "emociones": ["emoción 1", "..."],
      "sonidos": ["sonido ambiental 1", "..."],
      "musica": "música sugerida",
      "prompts": {{
        "principal": "prompt de imagen en inglés (incluye la biblia visual)",
        "alternativo": "variante del prompt en inglés",
        "cinematografico": "variante cinematográfica en inglés",
        "hiperrealista": "variante hiperrealista en inglés"
      }}
    }}
  ]
}}

Reglas:
- Todos los prompts de imagen DEBEN incorporar la biblia visual para mantener consistencia.
- La narración debe fluir de forma continua entre escenas, sin repeticiones.
- Devuelve exactamente {scenes} escenas numeradas de 1 a {scenes}."""


# ---- Public API -------------------------------------------------------------
async def analyze(idea: str) -> dict:
    try:
        data = await generate_json(system=_ANALYZE_SYSTEM, prompt=_analyze_prompt(idea), temperature=0.7)
        data["_provider"] = active_provider()
        return data
    except (LLMUnavailable, ValueError):
        return _mock_analysis(idea)


async def storyboard(idea: str, analysis: dict, target_seconds: int, aspect_ratio: str) -> dict:
    scenes = recommended_scene_count(target_seconds)
    try:
        data = await generate_json(
            system=_STORYBOARD_SYSTEM,
            prompt=_storyboard_prompt(idea, analysis, scenes, aspect_ratio),
            temperature=0.85,
            max_tokens=8192,
        )
        data["_provider"] = active_provider()
        # Normalise scene numbering + durations defensively.
        for i, sc in enumerate(data.get("escenas", []), start=1):
            sc.setdefault("numero", i)
        return data
    except (LLMUnavailable, ValueError):
        return _mock_storyboard(idea, analysis, scenes, aspect_ratio)


# ---- Deterministic mocks (offline / no API key) -----------------------------
def _seed(text: str) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)


def _mock_analysis(idea: str) -> dict:
    is_es = any(w in idea.lower() for w in (" el ", " la ", " un ", "cómo", "historia", " de "))
    idioma = "es" if is_es else "en"
    return {
        "idioma": idioma,
        "categoria": "General",
        "tono": "épico y misterioso",
        "audiencia": "amplia (13-45 años)",
        "formato": "corto",
        "duracion_recomendada_seg": 45,
        "titulo": idea.strip().capitalize()[:70] or "Video viral",
        "descripcion": f"Un video sobre: {idea}. Generado con Viral AI Studio.",
        "hashtags": ["#viral", "#ai", "#fyp", "#shorts", "#trending"],
        "keywords": [w for w in idea.lower().split() if len(w) > 3][:6] or ["video", "ai"],
        "categoria_video": "Entertainment",
        "gancho": idea.strip()[:80],
        "miniatura_prompt": f"cinematic dramatic thumbnail about {idea}, bold lighting, high contrast",
        "_provider": "mock",
    }


def _mock_storyboard(idea: str, analysis: dict, scenes: int, aspect_ratio: str) -> dict:
    idioma = analysis.get("idioma", "es")
    per = max(3, round(analysis.get("duracion_recomendada_seg", 45) / scenes))
    style = {
        "personajes": "protagonista consistente en todas las escenas",
        "paleta": "azules profundos y dorados cálidos",
        "iluminacion": "luz cinematográfica de bajo perfil",
        "estilo_visual": "cine fotorrealista 4K",
        "ambiente": analysis.get("tono", "épico y misterioso"),
    }
    base_visual = idea.strip()
    escenas = []
    for i in range(1, scenes + 1):
        consistency = (
            f"{style['estilo_visual']}, {style['paleta']}, {style['iluminacion']}, "
            f"{style['personajes']}, aspect ratio {aspect_ratio}"
        )
        subject = f"{base_visual} — momento {i} de {scenes}"
        escenas.append({
            "numero": i,
            "duracion_seg": per,
            "narracion": (
                f"({idioma}) Escena {i}: la historia avanza mostrando {base_visual}."
                if idioma == "es"
                else f"Scene {i}: the story unfolds showing {base_visual}."
            ),
            "visual": f"Plano de {subject}.",
            "movimientos": ["travelling lento", "zoom progresivo"] if i % 2 else ["paneo", "parallax"],
            "emociones": ["misterio", "tensión"] if i % 2 else ["asombro", "curiosidad"],
            "sonidos": ["viento", "ambiente profundo"],
            "musica": "banda sonora orquestal en crescendo",
            "prompts": {
                "principal": f"{subject}, {consistency}",
                "alternativo": f"{subject}, wide establishing shot, {consistency}",
                "cinematografico": f"{subject}, anamorphic lens, dramatic rim light, {consistency}",
                "hiperrealista": f"{subject}, hyperrealistic, 8k, intricate detail, {consistency}",
            },
        })
    return {"style_guide": style, "escenas": escenas, "_provider": "mock"}
