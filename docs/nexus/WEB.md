# NEXUS — Web intelligence

**Status: working.** Code: `backend/mata/nexus/tools/web.py`, `agents/research.py`.

- `web_search` — provider chain `NEXUS_SEARCH_PROVIDERS` (default searxng → tavily → brave →
  wikipedia); unconfigured providers are skipped; failures fall through and are reported.
- `web_fetch` — GET-only, redirects re-validated, private/loopback/metadata IPs blocked (SSRF
  guard), 1.5 MB cap, readable-text extraction. 401/402/403 pages are reported as requiring
  login/payment — **no bypass**.
- `research_topic` — research agent: generate queries → search → open top sources → synthesize a
  brief with inline citations and a "Conflicts" section. Sources are fenced as untrusted data.
- `weather` — Open-Meteo (free, keyless).

Movie/video lookups use the same tools and only point to official/legal sources; NEXUS never
downloads copyrighted content or circumvents DRM.
