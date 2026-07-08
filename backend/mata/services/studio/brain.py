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


_TRENDS_SYSTEM = (
    "Eres un analista de tendencias virales para Instagram Reels, TikTok, Facebook Reels y "
    "YouTube Shorts. Conoces los formatos, ganchos y temas que están funcionando ahora mismo "
    "y propones ideas de video concretas y accionables, no genéricas."
)


def _trends_prompt(niche: str, language: str, count: int) -> str:
    return f"""Genera {count} ideas de video viral EN TENDENCIA para este nicho.

Nicho: "{niche}"
Idioma de las ideas: {language}

Devuelve un objeto JSON con esta forma EXACTA:

{{
  "nicho": "{niche}",
  "tendencias": [
    {{
      "idea": "idea de video concreta lista para producir (1 frase)",
      "formato": "formato viral usado (ej. POV, storytelling, top 5, antes/después, dato impactante)",
      "gancho": "primera frase del video para retener en 3 segundos",
      "por_que_funciona": "razón breve de por qué este formato/tema es viral ahora",
      "potencial": "alto | medio"
    }}
  ]
}}

Reglas:
- Ideas específicas y producibles con imágenes IA + narración (nada de 'haz un vlog').
- Varía los formatos entre ideas.
- Devuelve exactamente {count} tendencias, ordenadas de mayor a menor potencial."""


_SEO_SYSTEM = (
    "Eres un experto en SEO y crecimiento orgánico para Instagram, Facebook, TikTok y YouTube. "
    "Escribes títulos de alto CTR, descripciones optimizadas y hashtags balanceados "
    "(mezcla de alto volumen, nicho y long-tail)."
)


def _seo_pack_prompt(title: str, description: str, category: str, language: str) -> str:
    return f"""Genera un pack SEO completo para publicar este video en redes.

Título base: "{title}"
Descripción: "{description}"
Categoría: "{category}"
Idioma: {language}

Devuelve un objeto JSON con esta forma EXACTA:

{{
  "titulos": ["10 títulos virales de alto CTR, máx 70 caracteres cada uno"],
  "descripciones": ["10 descripciones SEO distintas de 1-3 frases"],
  "hashtags": ["50 hashtags con # incluido: ~15 de alto volumen, ~20 de nicho, ~15 long-tail"],
  "caption_instagram": "caption listo para Instagram Reels: gancho + valor + CTA + 5 hashtags integrados, con saltos de línea y emojis",
  "caption_facebook": "caption listo para Facebook Reels: más conversacional, pregunta al final para comentarios, 3 hashtags",
  "mejor_hora": "mejor franja horaria sugerida para publicar este tipo de contenido",
  "cta": "llamada a la acción recomendada"
}}

Reglas:
- Exactamente 10 títulos, 10 descripciones y 50 hashtags.
- Sin clickbait falso: los títulos deben cumplir lo que prometen.
- Todo en {language}."""


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


async def trends(niche: str, language: str = "es", count: int = 8) -> dict:
    try:
        data = await generate_json(
            system=_TRENDS_SYSTEM, prompt=_trends_prompt(niche, language, count), temperature=0.9
        )
        data["_provider"] = active_provider()
        return data
    except (LLMUnavailable, ValueError):
        return _mock_trends(niche, language, count)


async def seo_pack(title: str, description: str = "", category: str = "General", language: str = "es") -> dict:
    try:
        data = await generate_json(
            system=_SEO_SYSTEM,
            prompt=_seo_pack_prompt(title, description, category, language),
            temperature=0.8,
            max_tokens=4096,
        )
        data["_provider"] = active_provider()
        return _normalize_seo(data, title, language)
    except (LLMUnavailable, ValueError):
        return _mock_seo_pack(title, language)


def _normalize_seo(data: dict, title: str, language: str) -> dict:
    """LLMs no siempre respetan los conteos exactos: rellena hasta 50 hashtags
    (con los del mock, sin duplicar) y recorta cualquier exceso."""
    mock = _mock_seo_pack(title, language)
    tags = [h if str(h).startswith("#") else f"#{h}" for h in data.get("hashtags", []) if h]
    seen = {t.lower() for t in tags}
    for extra in mock["hashtags"]:
        if len(tags) >= 50:
            break
        if extra.lower() not in seen:
            tags.append(extra)
            seen.add(extra.lower())
    data["hashtags"] = tags[:50]
    for key in ("titulos", "descripciones"):
        vals = [v for v in data.get(key, []) if v]
        data[key] = (vals + mock[key])[:10]
    data.setdefault("caption_instagram", mock["caption_instagram"])
    data.setdefault("caption_facebook", mock["caption_facebook"])
    return data


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


_MOCK_FORMATS = [
    ("storytelling", "La historia detrás de", "las historias reales retienen hasta el final"),
    ("top 5", "Los 5 secretos de", "las listas generan curiosidad por ver el #1"),
    ("dato impactante", "Lo que nadie te dijo sobre", "los datos sorprendentes se comparten"),
    ("POV", "POV: descubres", "el formato POV genera identificación inmediata"),
    ("antes/después", "Así cambió", "el contraste visual detiene el scroll"),
    ("mito vs realidad", "El mito más grande de", "corregir creencias genera comentarios"),
    ("pregunta abierta", "¿Por qué nadie habla de", "las preguntas abiertas suben la retención"),
    ("mini documental", "El caso increíble de", "el tono documental da autoridad"),
]


def _mock_trends(niche: str, language: str, count: int) -> dict:
    seed = _seed(niche)
    items = []
    for i in range(count):
        fmt, prefix, why = _MOCK_FORMATS[(seed + i) % len(_MOCK_FORMATS)]
        items.append({
            "idea": f"{prefix} {niche}",
            "formato": fmt,
            "gancho": f"{prefix} {niche}… y el final te va a sorprender.",
            "por_que_funciona": why,
            "potencial": "alto" if i < count // 2 else "medio",
        })
    return {"nicho": niche, "tendencias": items, "_provider": "mock"}


def _mock_seo_pack(title: str, language: str) -> dict:
    base = (title or "Video viral").strip()
    words = [w.strip("#,.!?").lower() for w in base.split() if len(w) > 3][:5] or ["video"]
    niche_tags = [f"#{w}" for w in words]
    volume = ["#viral", "#fyp", "#parati", "#reels", "#trending", "#shorts", "#explore",
              "#video", "#ai", "#foryou", "#viralvideo", "#reelsinstagram", "#instagood",
              "#tiktok", "#youtube"]
    longtail = [f"#{w}{s}" for w in words for s in ("tips", "2026", "viral", "facts", "secretos")][:35]
    generic = ["#contenido", "#creador", "#ideas", "#curiosidades", "#datos", "#historia",
               "#increible", "#sabiasque", "#aprende", "#descubre", "#momento", "#top",
               "#mejores", "#nuevo", "#hoy", "#mundo", "#vida", "#interesante", "#wow", "#quelocura"]
    hashtags: list[str] = []
    seen: set[str] = set()
    for h in volume + niche_tags + longtail + generic:
        if h.lower() not in seen:
            hashtags.append(h)
            seen.add(h.lower())
        if len(hashtags) == 50:
            break
    i = 1
    while len(hashtags) < 50:  # pad if the niche gave few usable words
        cand = f"#viral{i}"
        if cand not in seen:
            hashtags.append(cand)
            seen.add(cand)
        i += 1
    return {
        "titulos": [f"{base} — parte {i}" if i > 1 else base for i in range(1, 11)],
        "descripciones": [f"{base}. Descúbrelo en este video. #{i}" for i in range(1, 11)],
        "hashtags": hashtags,
        "caption_instagram": f"🔥 {base}\n\nNo te pierdas el final 👀\n\n➡️ Sígueme para más\n\n{' '.join(hashtags[:5])}",
        "caption_facebook": f"{base} 🤯\n\n¿Tú qué opinas? Te leo en los comentarios 👇\n\n{' '.join(hashtags[:3])}",
        "mejor_hora": "12:00-14:00 o 19:00-21:00 hora local",
        "cta": "Sígueme para más contenido como este",
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
