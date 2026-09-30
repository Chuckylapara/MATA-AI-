# NEXUS — Troubleshooting

| Symptom | Fix |
|---|---|
| Replies start with `[DEV MOCK …]` | No model configured. See QUICKSTART → "Give NEXUS a brain". |
| "Identity required" card | Sign in at `/login` (tokens expire after 15 min and refresh automatically). |
| Mic button does nothing / "not supported" | Use Chrome, Edge or Safari; allow the microphone; page must be on `localhost` or HTTPS. |
| NEXUS interrupts itself | Use headphones or lower speaker volume (TTS echo). |
| Camera tracking "Could not load tracking models" | The browser must reach `cdn.jsdelivr.net` and `storage.googleapis.com`. |
| Avatar slow | Settings → quality *medium* or *low*; close other GPU-heavy tabs. |
| Web search fails with "All search providers failed" | Wikipedia unreachable (offline or firewall); add SearXNG/Tavily. The error is shown exactly — NEXUS never invents results. |
| Vision answer says "integration not configured" | Add a vision-capable provider (Anthropic, Gemini, NVIDIA, or an Ollama VLM). |
| `System → ai_provider ERROR` | Dev mock disabled and no provider set. |
| Tasks never run | Backend must stay running; `NEXUS_SCHEDULER` must not be `0`. |
