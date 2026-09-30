"""Model providers. `build_providers()` returns every provider configured in settings."""
from __future__ import annotations

from mata.common.config import Settings, settings
from mata.nexus.providers.base import (
    CapabilityNotSupported,
    ChatMessage,
    ChatResult,
    ModelProvider,
    ProviderError,
)
from mata.nexus.providers.mock import DevMockProvider
from mata.nexus.providers.openai_compat import OpenAICompatibleProvider

__all__ = [
    "CapabilityNotSupported", "ChatMessage", "ChatResult", "ModelProvider", "ProviderError",
    "DevMockProvider", "OpenAICompatibleProvider", "build_providers",
]


def build_providers(cfg: Settings | None = None) -> dict[str, ModelProvider]:
    cfg = cfg or settings
    out: dict[str, ModelProvider] = {}
    if cfg.anthropic_api_key:
        from mata.nexus.providers.anthropic import AnthropicProvider

        out["anthropic"] = AnthropicProvider(cfg.anthropic_api_key)
    if cfg.openai_api_key:
        out["openai"] = OpenAICompatibleProvider(
            name="openai", base_url="https://api.openai.com/v1", api_key=cfg.openai_api_key,
            chat_model=cfg.openai_chat_model, vision_model=cfg.openai_chat_model, embed_model=cfg.openai_embed_model,
        )
    if cfg.nvidia_api_key:
        out["nvidia"] = OpenAICompatibleProvider(
            name="nvidia", base_url="https://integrate.api.nvidia.com/v1", api_key=cfg.nvidia_api_key,
            chat_model=cfg.nvidia_model, vision_model=cfg.nvidia_vision_model,
            # NVIDIA retires model ids over time; fall back to current catalogue models.
            alt_models=["meta/llama-3.1-8b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1",
                        "openai/gpt-oss-20b", "qwen/qwen2.5-7b-instruct", "microsoft/phi-3.5-mini-instruct",
                        "meta/llama-3.1-70b-instruct"],
        )
    if cfg.groq_api_key:
        out["groq"] = OpenAICompatibleProvider(
            name="groq", base_url="https://api.groq.com/openai/v1", api_key=cfg.groq_api_key,
            chat_model=cfg.groq_chat_model,
        )
    if cfg.ollama_base_url:
        out["ollama"] = OpenAICompatibleProvider(
            name="ollama", base_url=cfg.ollama_base_url, api_key=None, chat_model=cfg.ollama_model,
            vision_model=cfg.ollama_vision_model, embed_model=cfg.ollama_embed_model, local=True, timeout=180,
        )
    if cfg.gemini_api_key:
        from mata.nexus.providers.gemini import GeminiProvider

        out["gemini"] = GeminiProvider(cfg.gemini_api_key)
    if cfg.nexus_allow_dev_mock:
        out["mock"] = DevMockProvider()
    return out
