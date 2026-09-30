"""DEVELOPMENT-ONLY placeholder model.

It is not an AI and never pretends to be one: every reply is labelled, and
diagnostics report WARNING while it is active. It exists so the UI, voice loop,
memory and tool plumbing can be developed and tested with no API key.
"""
from __future__ import annotations

import json
import re

from mata.nexus.providers.base import ChatResult, ModelProvider, as_dicts

LABEL = "[DEV MOCK — el servidor no tiene claves de IA]"

# Minimal, transparent intent rules so tool plumbing can be exercised end-to-end.
_SEARCH = re.compile(r"\b(busca|buscar|search|investiga|research|find|encuentra)\b\s*(.*)", re.I)
_REMEMBER = re.compile(r"\b(recuerda que|remember that)\b\s*(.+)", re.I)
_REMIND = re.compile(r"\b(recu[eé]rdame|remind me)\b\s*(.+)", re.I)


class DevMockProvider(ModelProvider):
    name = "mock"
    capabilities = {"chat", "stream", "json"}
    local = True

    def model_for(self, role: str) -> str:
        return "dev-mock"

    async def chat(self, messages, *, system: str = "", temperature: float = 0.6, max_tokens: int = 1024,
                   role: str = "reasoning") -> ChatResult:
        msgs = as_dicts(messages)
        last = next((m["content"] for m in reversed(msgs) if m["role"] == "user"), "")
        if not isinstance(last, str):
            last = ""
        # Structured-output requests (orchestrator planning) get a plan in JSON.
        if "JSON Schema" in system:
            return ChatResult(text=json.dumps(self._plan(last, system)), provider=self.name, model="dev-mock")
        if last.startswith("TOOL RESULTS"):
            text = f"{LABEL} Tool results received. Summary unavailable without a real model:\n{last[12:600]}"
        else:
            text = (f"{LABEL} Recibí: \"{last[:200]}\". Para respuestas reales, añade GROQ_API_KEY, "
                    "GEMINI_API_KEY o NVIDIA_API_KEY en el servidor (Render → Environment) y reinícialo.")
        return ChatResult(text=text, provider=self.name, model="dev-mock")

    def _plan(self, text: str, system: str) -> dict:
        if '"reply"' not in system and '"tool_calls"' not in system:
            return {}
        if text.startswith("TOOL RESULTS"):
            return {"reply": ""}  # already acted this turn — hand over to the final answer
        if m := _REMEMBER.search(text):
            return {"tool_calls": [{"tool": "memory_write", "args": {"content": m.group(2).strip()}}]}
        if m := _REMIND.search(text):
            return {"tool_calls": [{"tool": "task_create", "args": {
                "title": m.group(2).strip()[:120], "kind": "reminder", "in_minutes": 60}}]}
        if (m := _SEARCH.search(text)) and m.group(2).strip():
            return {"tool_calls": [{"tool": "web_search", "args": {"query": m.group(2).strip()[:200]}}]}
        return {"reply": ""}
