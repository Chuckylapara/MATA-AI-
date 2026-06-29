"""Centralized configuration. Loaded once, shared by every service."""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Core ---
    environment: str = "development"
    log_level: str = "INFO"
    # Dev mode: use in-memory rate-limit + job queue instead of Redis (no Docker needed).
    dev_inmemory: bool = False

    # --- Database / cache ---
    database_url: str = "postgresql+asyncpg://mata:mata@db:5432/mata"
    redis_url: str = "redis://redis:6379/0"

    # --- Auth ---
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30

    # --- Seed admin ---
    seed_admin_email: str = "admin@mata.ai"
    seed_admin_password: str = "admin12345"

    # --- Inter-service URLs (gateway uses these) ---
    auth_service_url: str = "http://auth:8001"
    chat_service_url: str = "http://chat:8002"
    image_service_url: str = "http://image:8003"
    video_service_url: str = "http://video:8004"
    music_service_url: str = "http://music:8005"
    code_service_url: str = "http://code:8006"
    agent_service_url: str = "http://agent:8007"
    billing_service_url: str = "http://billing:8008"
    admin_service_url: str = "http://admin:8009"
    studio_service_url: str = "http://studio:8010"
    clips_service_url: str = "http://clips:8011"
    tools_service_url: str = "http://tools:8012"

    # --- Provider keys (optional — mock providers used when absent) ---
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    openai_api_key: str | None = None
    nvidia_api_key: str | None = None  # NVIDIA NIM (build.nvidia.com) — OpenAI-compatible, fast
    groq_api_key: str | None = None    # Groq Whisper (fast, cheap audio transcription for Clips)
    hf_token: str | None = None        # Hugging Face Inference API (free image/music models)
    replicate_api_token: str | None = None
    elevenlabs_api_key: str | None = None
    elevenlabs_voice_id: str | None = None
    kie_api_key: str | None = None  # kie.ai — backup for images/video/music
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    # --- PayPal (subscriptions + one-time credit packs) ---
    paypal_client_id: str | None = None
    paypal_secret: str | None = None
    paypal_env: str = "sandbox"          # "sandbox" while testing, "live" to charge real money
    paypal_webhook_id: str | None = None  # from the PayPal app webhook config (verifies events)
    paypal_plan_pro: str | None = None    # billing plan id created via scripts/paypal_setup.py
    paypal_plan_business: str | None = None
    # Public URL of the frontend, used for PayPal return/cancel redirects.
    public_app_url: str = "http://localhost:3000"

    @property
    def paypal_api_base(self) -> str:
        return "https://api-m.paypal.com" if self.paypal_env == "live" else "https://api-m.sandbox.paypal.com"

    @property
    def paypal_enabled(self) -> bool:
        return bool(self.paypal_client_id and self.paypal_secret)

    # --- Default model ids ---
    chat_model: str = "claude-opus-4-8"
    code_model: str = "claude-opus-4-8"
    agent_model: str = "claude-opus-4-8"
    gemini_model: str = "gemini-2.5-flash"
    nvidia_model: str = "meta/llama-3.1-70b-instruct"
    nvidia_vision_model: str = "meta/llama-3.2-11b-vision-instruct"  # NVIDIA image understanding
    whisper_model: str = "whisper-large-v3"   # used with Groq/OpenAI-compatible STT
    hf_image_model: str = "black-forest-labs/FLUX.1-schnell"  # HF text-to-image

    # --- CORS ---
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
