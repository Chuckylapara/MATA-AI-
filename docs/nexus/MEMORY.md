# NEXUS — Memory

Code: `backend/mata/nexus/memory.py`, `embeddings.py`. UI: Memory Center.

## Types
short_term (auto-expires 24 h), conversation, semantic, personal, preference, project, task,
relationship, document, work, creative, technical.

## Retrieval (never dumps history)
`score = 0.65·similarity + 0.15·recency(30-day half-life) + 0.15·importance + 0.05·usage`,
top-6 above a threshold are injected. Vectors are only compared within the same embedding model;
mismatches fall back to the local model for both sides.

## Writing
- Explicit: "Recuerda que…", Memory Center, `memory_write` tool.
- Automatic extraction (rule-based, ES/EN) from the user's own words: name ("me llamo Erick"),
  projects ("estoy creando una empresa"), preferences, location, work.
- Near-duplicates (cosine ≥ 0.92) update the existing memory instead of adding one.
- Secrets and credentials are refused; sensitive data is never auto-extracted.

## Control
View, semantic search, filter by type, add, edit, delete, delete-all (explicit confirm), export
JSON, consolidate (merge duplicates, drop expired), disable (no reads, no writes).

## Embeddings
Ollama `nomic-embed-text` / OpenAI / Gemini when configured; otherwise a deterministic 256-d
hashed n-gram embedding (offline; diagnostics report WARNING because it's lexical, not neural).
Scale path: pgvector (Postgres) or sqlite-vec.
