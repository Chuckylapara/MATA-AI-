# NEXUS — AI models

See the strategy in [../AI_MODEL_STRATEGY.md](../AI_MODEL_STRATEGY.md).

## Roles and routing
`ModelRouter.chain(role)` orders configured providers by preference; failures fall back to the
next provider and emit `PROVIDER_FALLBACK` (visible in System → event trace).

| Role | Order |
|---|---|
| fast | groq → ollama → nvidia → gemini → anthropic → openai → mock |
| reasoning | anthropic → openai → nvidia → gemini → groq → ollama → mock |
| vision | anthropic → gemini → nvidia → openai → ollama |
| embeddings | ollama → openai → gemini → *local hashed (built-in)* |

Force a role: `NEXUS_REASONING_PROVIDER=ollama` (etc.).

## Adding a provider
Subclass `ModelProvider` (`backend/mata/nexus/providers/base.py`), implement `chat` (and
optionally `stream`, `vision`, `embeddings`), then register it in `providers/__init__.py`.
Any OpenAI-compatible server (vLLM, LM Studio, llama.cpp server) works with
`OpenAICompatibleProvider` by adding one entry.

## The dev mock
`DevMockProvider` is **not an AI**. It exists for development and tests, labels every reply,
and makes diagnostics report WARNING. Disable it with `NEXUS_ALLOW_DEV_MOCK=false` (then NEXUS
reports ERROR until a real provider is configured).

## Local model advice
`GET /nexus/system/hardware` detects CPU/RAM/GPU/VRAM and recommends Ollama models per tier.
NEXUS never downloads models automatically.
