"""Mata Health AI — orchestration brain.

This module is deliberately conservative: it assists with prevention and triage,
it never outputs a definitive diagnosis or a medication dose, and every symptom
message passes through a **rule-based emergency safety net** (`detect_emergency`)
that does not depend on the LLM being available or answering correctly. The LLM
adds nuance on top of that net — it never replaces it.
"""
from __future__ import annotations

import re

import httpx

from mata.common.config import settings
from mata.common.llm import LLMUnavailable, active_provider, generate_json

SAFETY_DISCLAIMER = (
    "Esto no es un diagnóstico médico. Es una orientación preventiva generada por IA. "
    "Ante cualquier duda seria, consulta a un profesional de la salud."
)

# Rule-based emergency net — checked on every symptom message regardless of LLM
# availability. Keep this list short and high-precision (red-flag phrases only).
_EMERGENCY_PATTERNS = [
    (r"dolor.{0,15}(fuerte|intenso|opresi).{0,20}(pecho|torax|corazon)", "Posible dolor torácico intenso"),
    (r"(no puedo|dificultad|falta).{0,15}(respirar|aire|aliento)", "Posible dificultad respiratoria"),
    (r"(perdi|pérdida).{0,10}(conciencia|conocimiento)|(me desmay|se desmay)", "Posible pérdida de conciencia"),
    (r"sangrado.{0,15}(abundante|no para|no se detiene|importante|mucho)", "Posible sangrado importante"),
    (r"(labios|dedos|cara).{0,15}(morad|azul)", "Posible signo de falta de oxígeno"),
    (r"(convulsi[oó]n|convulsionando)", "Posible convulsión"),
    (r"(pensamiento|ideas?).{0,10}suicid|quiero morir|quitarme la vida", "Posible riesgo de autolesión"),
    (r"reacci[oó]n al[eé]rgica.{0,20}(grave|garganta|hinchaz[oó]n)", "Posible reacción alérgica grave"),
    (r"golpe.{0,15}cabeza.{0,20}(confus|vomit|no recuerd)", "Posible lesión craneal con síntomas de alarma"),
    (r"\bchest pain\b|\bcan.?t breathe\b|\bunconscious\b|\bsevere bleeding\b", "English-language emergency phrase detected"),
]
_EMERGENCY_RE = [(re.compile(p, re.IGNORECASE), reason) for p, reason in _EMERGENCY_PATTERNS]

EMERGENCY_MESSAGE = "Busca ayuda médica de emergencia ahora (línea de emergencias local o el hospital más cercano)."


def detect_emergency(text: str) -> str | None:
    """Rule-based net. Returns the matched reason, or None."""
    for pattern, reason in _EMERGENCY_RE:
        if pattern.search(text):
            return reason
    return None


_TRIAGE_SYSTEM = """Eres el asistente de síntomas de Mata Health AI, una app de prevención de salud.

REGLAS ESTRICTAS:
- NUNCA das un diagnóstico definitivo. NUNCA recetas medicamentos ni dosis.
- Eres un asistente de orientación preventiva: organizas síntomas, haces preguntas
  inteligentes de seguimiento y recomiendas cuándo buscar atención médica.
- Si detectas señales de emergencia (dolor de pecho fuerte, dificultad para respirar,
  pérdida de conciencia, sangrado importante, ideas de autolesión, reacción alérgica
  grave), marca emergency=true y explica brevemente por qué.
- Responde siempre en el idioma del usuario (por defecto español).
- Sé breve, cálido y claro. Evita jerga médica innecesaria.

Responde ÚNICAMENTE con un JSON con esta forma exacta:
{
  "reply": "respuesta conversacional breve para el usuario",
  "follow_up_questions": ["pregunta 1", "pregunta 2"],
  "summary": "resumen de una frase de los síntomas reportados hasta ahora",
  "emergency": false,
  "emergency_reason": null,
  "recommend_doctor": false
}"""


def _mock_triage(message: str, emergency_reason: str | None) -> dict:
    """Deterministic fallback so the assistant still works with zero API keys."""
    lowered = message.lower()
    watchwords = ["fiebre", "dolor", "mareo", "cansancio", "fatiga", "tos", "nausea", "náusea"]
    hit = next((w for w in watchwords if w in lowered), None)
    return {
        "reply": (
            f"Gracias por contarme. Registré que mencionas: \"{message.strip()[:200]}\". "
            + (f"Vamos a darle seguimiento a '{hit}'. " if hit else "")
            + "¿Desde cuándo lo sientes y qué tan intenso es, del 1 al 10?"
        ),
        "follow_up_questions": [
            "¿Desde cuándo tienes este síntoma?",
            "¿Qué tan intenso es, de 1 a 10?",
            "¿Ha empeorado en las últimas horas?",
        ],
        "summary": message.strip()[:180],
        "emergency": bool(emergency_reason),
        "emergency_reason": emergency_reason,
        "recommend_doctor": bool(emergency_reason),
    }


async def triage_chat(*, history: list[dict], message: str, profile: dict | None) -> dict:
    emergency_reason = detect_emergency(message)

    profile_line = ""
    if profile:
        bits = [f"{k}: {v}" for k, v in profile.items() if v]
        if bits:
            profile_line = "Perfil del usuario — " + ", ".join(bits)

    convo = "\n".join(f"{h.get('role', 'user')}: {h.get('content', '')}" for h in history[-8:])
    prompt = f"{profile_line}\n\nConversación previa:\n{convo}\n\nNuevo mensaje del usuario:\n{message}".strip()

    try:
        data = await generate_json(system=_TRIAGE_SYSTEM, prompt=prompt, temperature=0.4, max_tokens=700)
        if not isinstance(data, dict):
            raise ValueError("not a dict")
    except (LLMUnavailable, Exception):
        data = _mock_triage(message, emergency_reason)

    # The rule-based net always wins — never let the LLM downgrade a red flag.
    if emergency_reason and not data.get("emergency"):
        data["emergency"] = True
        data["emergency_reason"] = emergency_reason
        data["recommend_doctor"] = True
    data.setdefault("follow_up_questions", [])
    data.setdefault("summary", message.strip()[:180])
    data["disclaimer"] = SAFETY_DISCLAIMER
    data["provider"] = active_provider()
    return data


SCAN_PROMPTS = {
    "piel": "Eres un asistente de prevención visual. Observa la piel en la imagen: color, irritación, "
    "enrojecimiento, sequedad, ronchas o heridas visibles. Describe lo que ves de forma objetiva.",
    "lunar": "Observa el lunar o mancha en la imagen. Comenta forma, bordes, color y tamaño aparente de forma "
    "objetiva (asimetría, bordes irregulares, múltiples colores, diámetro grande son señales para vigilar — "
    "la regla ABCDE — pero NO diagnostiques cáncer de piel ni ninguna enfermedad).",
    "ojos": "Observa los ojos en la imagen: enrojecimiento, hinchazón, color de la esclerótica, secreción visible.",
    "rostro": "Observa el rostro: signos visibles de cansancio (ojeras, palidez), hinchazón, asimetría, color de piel.",
    "labios": "Observa los labios: color, resequedad, hinchazón, heridas o lesiones visibles.",
    "manos": "Observa las manos: hinchazón, color, temblor aparente, heridas, irritación de piel, uñas.",
    "herida": "Observa la herida visible: tamaño aparente, color, signos de enrojecimiento alrededor, secreción.",
    "postura": "Observa la postura corporal: alineación de hombros y espalda, asimetrías visibles.",
    "general": "Observa la imagen en busca de cualquier señal visible relevante para el bienestar general.",
}


def _scan_system(area: str) -> str:
    focus = SCAN_PROMPTS.get(area, SCAN_PROMPTS["general"])
    return f"""Eres el escáner corporal de Mata Health AI, un asistente de PREVENCIÓN, no de diagnóstico.

{focus}

REGLAS ESTRICTAS:
- Describe solo lo que es visualmente observable. No diagnostiques ninguna enfermedad.
- Nunca digas el nombre de una enfermedad como si fuera certero.
- Clasifica severity como "normal" (nada relevante), "watch" (vale la pena vigilar / consultar si no mejora)
  o "urgent" (señal que amerita atención médica pronto — heridas muy abiertas, hinchazón severa, cambios muy
  marcados en un lunar, signos de infección extendida).
- Termina siempre con una recomendación clara y breve.

Responde ÚNICAMENTE con JSON:
{{
  "observations": "descripción objetiva de lo observado, 2-4 frases",
  "severity": "normal" | "watch" | "urgent",
  "recommendation": "recomendación breve y clara para el usuario"
}}"""


def _mock_scan(area: str, reason: str = "El análisis por IA de visión no está disponible en este momento.") -> dict:
    return {
        "observations": reason,
        "severity": "watch",
        "recommendation": "Vuelve a intentarlo más tarde, o consulta a un profesional si la zona te preocupa.",
    }


async def analyze_scan(*, image_data_url: str, area: str) -> dict:
    if not settings.nvidia_api_key:
        return _mock_scan(area, "No se pudo ejecutar el análisis por IA de visión (falta configurar NVIDIA_API_KEY en el servidor).")

    payload = {
        "model": settings.nvidia_vision_model,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "Analiza esta imagen siguiendo tus instrucciones de sistema."},
                {"type": "image_url", "image_url": {"url": image_data_url}},
            ],
        }],
        "max_tokens": 500,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {settings.nvidia_api_key}"}
    system = _scan_system(area)
    # NVIDIA's OpenAI-compatible endpoint takes system as a separate message.
    payload["messages"].insert(0, {"role": "system", "content": system})

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "https://integrate.api.nvidia.com/v1/chat/completions", headers=headers, json=payload
        )
    if resp.status_code != 200:
        return _mock_scan(area, "No se pudo analizar la imagen (el servicio de visión no respondió). Prueba con otra foto.")
    raw = resp.json()["choices"][0]["message"]["content"]
    try:
        from mata.common.llm import _extract_json

        data = _extract_json(raw)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        data = {"observations": raw[:600], "severity": "watch", "recommendation": SAFETY_DISCLAIMER}

    data.setdefault("severity", "watch")
    if data["severity"] not in ("normal", "watch", "urgent"):
        data["severity"] = "watch"
    data["disclaimer"] = SAFETY_DISCLAIMER
    return data


_REPORT_SYSTEM = """Eres el generador de reportes semanales de Mata Health AI.
A partir del historial de síntomas y escaneos de un usuario en los últimos 7 días,
genera un resumen útil para llevar al médico. No diagnostiques. Sé concreto y breve.

Responde ÚNICAMENTE con JSON:
{
  "summary": "resumen general de la semana, 2-4 frases",
  "changes_detected": ["cambio 1", "cambio 2"],
  "symptoms_recap": ["síntoma reportado 1", "síntoma reportado 2"],
  "questions_for_doctor": ["pregunta sugerida 1", "pregunta sugerida 2"]
}"""


def _mock_report(entries: list[dict]) -> dict:
    symptoms = [e["summary"] for e in entries if e.get("kind") == "symptom_chat"][:6]
    scans = [e["summary"] for e in entries if e.get("kind") == "scan"][:6]
    return {
        "summary": f"Se registraron {len(entries)} eventos esta semana." if entries else "Sin actividad registrada esta semana.",
        "changes_detected": scans or ["Sin cambios visuales registrados."],
        "symptoms_recap": symptoms or ["Sin síntomas registrados."],
        "questions_for_doctor": [
            "¿Estos síntomas están relacionados entre sí?",
            "¿Necesito algún estudio de laboratorio?",
        ],
    }


async def weekly_report(*, entries: list[dict], profile: dict | None) -> dict:
    if not entries:
        return _mock_report(entries)
    lines = [f"- [{e.get('kind')}] {e.get('summary')} (severidad: {e.get('severity')})" for e in entries]
    prompt = "Eventos de la semana:\n" + "\n".join(lines)
    try:
        data = await generate_json(system=_REPORT_SYSTEM, prompt=prompt, temperature=0.3, max_tokens=800)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        data = _mock_report(entries)
    data["disclaimer"] = SAFETY_DISCLAIMER
    return data


_WELLNESS_SYSTEM = """Eres el asistente de bienestar de Mata Health AI. Da recomendaciones generales
y seguras de estilo de vida (sueño, hidratación, actividad física, alimentación, hábitos).
NUNCA des dosis de medicamentos ni indicaciones médicas específicas.

Responde ÚNICAMENTE con JSON:
{
  "sleep": "recomendación breve",
  "hydration": "recomendación breve",
  "activity": "recomendación breve",
  "nutrition": "recomendación breve",
  "habits": "recomendación breve"
}"""


def _mock_wellness() -> dict:
    return {
        "sleep": "Mantén un horario de sueño constante, 7-9 horas por noche.",
        "hydration": "Bebe agua a lo largo del día; una guía común es ~30ml por kg de peso.",
        "activity": "Al menos 150 minutos de actividad moderada por semana, o caminatas diarias de 20-30 min.",
        "nutrition": "Prioriza vegetales, proteína y agua sobre ultraprocesados y azúcar añadida.",
        "habits": "Reduce pantallas antes de dormir y toma descansos activos durante el día.",
    }


async def wellness_tips(*, profile: dict | None, recent_summary: str | None) -> dict:
    prompt = "Perfil: " + str(profile or {}) + "\nResumen reciente de salud: " + (recent_summary or "sin datos")
    try:
        data = await generate_json(system=_WELLNESS_SYSTEM, prompt=prompt, temperature=0.6, max_tokens=500)
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        data = _mock_wellness()
    return data
