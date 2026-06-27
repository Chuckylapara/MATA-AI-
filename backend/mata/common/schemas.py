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


# --- Billing ---
class CheckoutIn(BaseModel):
    tier: str = Field(pattern="^(pro|business)$")
