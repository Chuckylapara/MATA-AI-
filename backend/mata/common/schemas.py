"""Shared Pydantic request/response schemas."""
from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


# --- Auth ---
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshIn(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    full_name: str | None
    role: str
    tier: str
    credits: int

    model_config = {"from_attributes": True}


# --- Chat ---
class ChatMessage(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    messages: list[ChatMessage] = Field(min_length=1)
    model: str | None = None
    stream: bool = False
    temperature: float = 0.7


# --- Generation modules ---
class ImageRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    size: str = "1024x1024"
    n: int = Field(default=1, ge=1, le=4)
    style: str | None = None


class VideoRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    duration_seconds: int = Field(default=5, ge=1, le=60)
    aspect_ratio: str = "16:9"
    variant: int = Field(default=0, ge=0, le=10)  # distinct variation when generating several


class MusicRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    duration_seconds: int = Field(default=30, ge=5, le=300)
    genre: str | None = None
    variant: int = Field(default=0, ge=0, le=10)  # distinct variation when generating several


class CodeRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    language: str = "python"
    mode: str = Field(default="generate", pattern="^(generate|explain|review|fix)$")


class AgentRequest(BaseModel):
    goal: str = Field(min_length=1, max_length=4000)
    max_steps: int = Field(default=6, ge=1, le=20)


class JobOut(BaseModel):
    id: str
    status: str
    result_url: str | None = None
    result_data: dict | None = None
    error: str | None = None


# --- Viral AI Studio ---
class StudioIdeaIn(BaseModel):
    idea: str = Field(min_length=2, max_length=2000)


class StudioStoryboardIn(BaseModel):
    idea: str = Field(min_length=2, max_length=2000)
    analysis: dict | None = None  # reuse a prior /analyze result to save a call
    target_seconds: int = Field(default=45, ge=10, le=7200)
    aspect_ratio: str = Field(default="9:16", pattern="^(9:16|16:9|1:1)$")


class StudioSceneImagesIn(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    n: int = Field(default=1, ge=1, le=4)
    aspect_ratio: str = Field(default="9:16", pattern="^(9:16|16:9|1:1)$")
    style: str | None = None


class StudioVoiceoverIn(BaseModel):
    text: str = Field(min_length=1, max_length=5000)
    voice: str = Field(default="narrador")
    language: str = Field(default="es", max_length=10)


class StudioSubtitlesIn(BaseModel):
    escenas: list[dict] = Field(min_length=1)
    fmt: str = Field(default="srt", pattern="^(srt|vtt)$")
    language: str | None = None  # translate to this language; None = original


class StudioRenderIn(BaseModel):
    escenas: list[dict] = Field(min_length=1, max_length=60)
    aspect_ratio: str = Field(default="9:16", pattern="^(9:16|16:9|1:1)$")
    resolution: str = Field(default="1080p", pattern="^(720p|1080p)$")
    voice: str = Field(default="narrador")
    language: str = Field(default="es", max_length=10)
    burn_subtitles: bool = False
    animate: bool = False           # AI image->video per scene (kie.ai)
    background_music: bool = False  # AI background track (kie.ai/Suno)
    title: str | None = Field(default=None, max_length=200)  # for the history/panel


class StudioThumbnailIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    style: str | None = None
    aspect_ratio: str = Field(default="16:9", pattern="^(9:16|16:9|1:1)$")


# --- Billing ---
class CheckoutIn(BaseModel):
    tier: str = Field(pattern="^(pro|business)$")


class PayPalSubscribeIn(BaseModel):
    tier: str = Field(pattern="^(pro|business)$")


class PayPalOrderIn(BaseModel):
    pack: str = Field(pattern="^(small|medium|large)$")


class PayPalCaptureIn(BaseModel):
    order_id: str = Field(min_length=1, max_length=64)
