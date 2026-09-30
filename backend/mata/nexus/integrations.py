"""Integration (plugin) registry.

Each integration declares what it needs. Status is computed from real
configuration — never assumed. Unconfigured integrations are shown as
"NOT CONFIGURED" with the exact setup steps.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

from mata.common.config import settings


@dataclass
class Integration:
    id: str
    name: str
    category: str
    required: list[str]           # settings attribute names / env vars (all required)
    setup: list[str]
    docs_url: str
    provides: list[str] = field(default_factory=list)
    cost: str = "free"
    #: "available" (code exists, needs config) or "planned" (code not written yet)
    implementation: str = "available"


def _is_set(key: str) -> bool:
    val = getattr(settings, key.lower(), None)
    if val is None:
        val = os.getenv(key.upper())
    return bool(val)


INTEGRATIONS: list[Integration] = [
    # --- models ---
    Integration("anthropic", "Anthropic Claude", "ai-model", ["ANTHROPIC_API_KEY"],
                ["Create a key at console.anthropic.com", "Set ANTHROPIC_API_KEY in .env"],
                "https://docs.anthropic.com", ["reasoning", "vision"], "paid"),
    Integration("openai", "OpenAI", "ai-model", ["OPENAI_API_KEY"],
                ["Create a key at platform.openai.com", "Set OPENAI_API_KEY"], "https://platform.openai.com/docs",
                ["reasoning", "vision", "embeddings"], "paid"),
    Integration("nvidia", "NVIDIA NIM", "ai-model", ["NVIDIA_API_KEY"],
                ["Get a free key at build.nvidia.com", "Set NVIDIA_API_KEY"], "https://build.nvidia.com",
                ["reasoning", "vision"], "free dev credits"),
    Integration("groq", "Groq", "ai-model", ["GROQ_API_KEY"],
                ["Create a key at console.groq.com", "Set GROQ_API_KEY"], "https://console.groq.com/docs",
                ["fast"], "free tier"),
    Integration("gemini", "Google Gemini", "ai-model", ["GEMINI_API_KEY"],
                ["Create a key at aistudio.google.com", "Set GEMINI_API_KEY"], "https://ai.google.dev",
                ["reasoning", "vision", "embeddings"], "free tier"),
    Integration("ollama", "Ollama (local models)", "ai-model", ["OLLAMA_BASE_URL"],
                ["Install Ollama from ollama.com", "ollama pull llama3.1:8b && ollama pull nomic-embed-text",
                 "Set OLLAMA_BASE_URL=http://localhost:11434/v1"], "https://docs.ollama.com",
                ["fast", "reasoning", "vision", "embeddings"], "free, local"),
    # --- search ---
    Integration("wikipedia", "Wikipedia API", "search", [], [], "https://www.mediawiki.org/wiki/API:Search",
                ["web_search"], "free"),
    Integration("searxng", "SearXNG (self-hosted)", "search", ["SEARXNG_URL"],
                ["docker run -p 8888:8080 searxng/searxng", "Enable the json format in settings.yml",
                 "Set SEARXNG_URL=http://localhost:8888"], "https://docs.searxng.org", ["web_search"], "free"),
    Integration("tavily", "Tavily Search", "search", ["TAVILY_API_KEY"],
                ["Create a key at tavily.com (1,000 free searches/month)", "Set TAVILY_API_KEY"],
                "https://docs.tavily.com", ["web_search"], "free tier"),
    Integration("brave", "Brave Search API", "search", ["BRAVE_API_KEY"],
                ["Subscribe at api-dashboard.search.brave.com (card required)", "Set BRAVE_API_KEY"],
                "https://api-dashboard.search.brave.com/app/documentation", ["web_search"], "paid"),
    # --- communication (planned code; always NOT CONFIGURED until built + credentials) ---
    Integration("gmail", "Gmail", "communication", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
                ["Create an OAuth client in Google Cloud Console (Gmail API enabled)",
                 "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET", "Connect your account from NEXUS → Settings"],
                "https://developers.google.com/gmail/api", ["email_send", "email_read"], "free",
                implementation="planned"),
    Integration("google_calendar", "Google Calendar", "communication", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
                ["Enable Calendar API on the same OAuth client", "Connect from NEXUS → Settings"],
                "https://developers.google.com/calendar/api", ["calendar"], "free", implementation="planned"),
    Integration("telegram", "Telegram Bot", "communication", ["TELEGRAM_BOT_TOKEN"],
                ["Create a bot with @BotFather", "Set TELEGRAM_BOT_TOKEN"], "https://core.telegram.org/bots/api",
                ["message_send"], "free", implementation="planned"),
    # --- social / shopping / browser (planned) ---
    Integration("youtube", "YouTube Data API", "social", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
                ["Enable YouTube Data API v3", "Connect your channel from NEXUS → Social"],
                "https://developers.google.com/youtube/v3", ["social_publish"], "free quota",
                implementation="planned"),
    Integration("instagram", "Instagram Graph API", "social", ["META_APP_ID", "META_APP_SECRET"],
                ["Create a Meta app with Instagram Graph API (business/creator account)", "Set META_APP_ID/SECRET"],
                "https://developers.facebook.com/docs/instagram-api", ["social_publish"], "free",
                implementation="planned"),
    Integration("shopping", "Store APIs (eBay Browse / Shopify)", "shopping", ["EBAY_APP_ID"],
                ["Create an eBay developer app", "Set EBAY_APP_ID"], "https://developer.ebay.com/api-docs/buy/browse",
                ["shopping_search", "shopping_purchase"], "free", implementation="planned"),
    Integration("playwright", "Browser automation (Playwright)", "browser", ["NEXUS_BROWSER_ENABLED"],
                ["pip install playwright", "Set NEXUS_BROWSER_ENABLED=1"], "https://playwright.dev/python",
                ["browser"], "free", implementation="planned"),
]

_BY_ID = {i.id: i for i in INTEGRATIONS}


def integration_status(integration_id: str) -> dict:
    i = _BY_ID.get(integration_id)
    if i is None:
        return {"id": integration_id, "name": integration_id, "configured": False, "status": "UNKNOWN",
                "setup": [f"Unknown integration '{integration_id}'"]}
    creds_ok = all(_is_set(k) for k in i.required)
    configured = creds_ok and i.implementation == "available"
    if i.implementation == "planned":
        status = "PLANNED"
    else:
        status = "CONFIGURED" if configured else "NOT CONFIGURED"
    return {"id": i.id, "name": i.name, "category": i.category, "configured": configured, "status": status,
            "credentials_present": creds_ok, "required": i.required, "setup": i.setup, "docs_url": i.docs_url,
            "provides": i.provides, "cost": i.cost, "implementation": i.implementation}


def list_integrations() -> list[dict]:
    return [integration_status(i.id) for i in INTEGRATIONS]
