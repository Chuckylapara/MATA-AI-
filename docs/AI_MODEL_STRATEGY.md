# NEXUS — AI Model Strategy

## 1. Principle: roles, not vendors

NEXUS never calls a vendor SDK directly from business logic. It asks the `ModelRouter`
for a **role**, and the router returns a `ModelProvider`:

| Role | Used for | Preferred order (first configured wins) |
|---|---|---|
| `fast` | intent detection, short replies, memory extraction | Groq → Ollama (local) → NVIDIA NIM → Gemini → Anthropic → OpenAI → DevMock |
| `reasoning` | planning, tool use, research synthesis | Anthropic → OpenAI → NVIDIA NIM → Gemini → Ollama → DevMock |
| `vision` | camera questions, OCR, documents with images | Anthropic → Gemini → NVIDIA vision → OpenAI → Ollama (VLM) → none |
| `embeddings` | memory & document retrieval | Ollama `nomic-embed-text` → OpenAI → Gemini → local hashed embeddings |

Override per role with env vars: `NEXUS_FAST_PROVIDER`, `NEXUS_REASONING_PROVIDER`,
`NEXUS_VISION_PROVIDER`, `NEXUS_EMBED_PROVIDER` (values: `anthropic`, `openai`, `nvidia`,
`groq`, `ollama`, `gemini`, `mock`).

## 2. The `ModelProvider` interface

```python
class ModelProvider(ABC):
    name: str
    capabilities: set[str]            # {"chat","stream","vision","embeddings","tools","json"}
    async def chat(messages, *, system, temperature, max_tokens) -> ChatResult
    async def stream(messages, *, system, ...) -> AsyncIterator[str]
    async def vision(prompt, image_b64, mime) -> ChatResult
    async def embeddings(texts) -> list[list[float]]
    async def structured_output(messages, schema, *, system) -> dict
```

`structured_output` asks for JSON matching a schema and validates it; providers without
native JSON mode get a JSON-only instruction + robust extraction + one repair retry.

Implementations (`backend/mata/nexus/providers/`):

- `AnthropicProvider` — Messages API (streaming, vision, tool use).
- `OpenAICompatibleProvider` — one class for OpenAI, NVIDIA NIM, Groq and **Ollama**
  (`OLLAMA_BASE_URL`, default `http://localhost:11434/v1`), differing only in base URL, key and
  model ids.
- `GeminiProvider` — REST generateContent / streamGenerateContent / embedContent.
- `DevMockProvider` — **development only**. Deterministic, never pretends to be an AI: every
  reply is prefixed `[DEV MOCK — no AI provider configured]` and diagnostics report `WARNING`.

## 3. Local models vs. hardware

`mata/nexus/hardware.py` detects CPU, RAM, GPU/VRAM (via `nvidia-smi`, Apple Silicon unified
memory heuristic), OS, storage and network, then recommends:

| Detected | Local recommendation (Ollama) |
|---|---|
| ≥ 24 GB VRAM | `qwen2.5:32b` / `llama3.3:70b-q4` (reasoning), `qwen2.5vl:7b` (vision) |
| 10–24 GB VRAM | `qwen2.5:14b`, `llama3.1:8b` (fast), `qwen2.5vl:7b` |
| 6–10 GB VRAM or Apple ≥ 16 GB | `llama3.1:8b` / `qwen2.5:7b`, `moondream` (vision) |
| CPU only, ≥ 16 GB RAM | `qwen2.5:3b` / `llama3.2:3b` (fast only); cloud for reasoning |
| < 16 GB RAM | cloud providers only; local hashed embeddings |

Recommendations are advice shown in System Health; NEXUS does not download models by itself.

## 4. Failure & fallback

- Each call has a timeout. On provider error the router tries the next configured provider
  for that role and emits a `PROVIDER_FALLBACK` event (visible in the action feed).
- If all fail, the user is told which providers failed. NEXUS never fabricates an answer.

## 5. Persona

`mata/nexus/persona.py`: intelligent, calm, helpful, fast, natural, curious, professional,
occasionally humorous, transparent. Never claims consciousness or human emotions; avatar
"emotions" are presented as expressive states. Replies in the user's language (default
Spanish/English auto-detect).
