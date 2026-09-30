# NEXUS — HTTP API

Base: `/nexus` through the gateway (or the devserver). All endpoints need `Authorization: Bearer <access token>`.
Interactive schema: run the devserver and open `http://localhost:8000/nexus/docs`.

| Endpoint | Description |
|---|---|
| `GET /status` | model routing, dev-mock flag, agents, configured integrations |
| `POST /converse` `{text, conversation_id?, channel?}` | SSE turn (see ARCHITECTURE.md for events) |
| `POST /vision/ask` `{question, image_b64, mime}` | vision question about one frame |
| `POST /events` `{name, data}` | client events: CAMERA_ENABLED/DISABLED, USER_INTERRUPTED |
| `GET/PUT/DELETE /profile` | profile; DELETE wipes personal data |
| `GET /memories?q=&type=` · `POST /memories` · `PATCH/DELETE /memories/{id}` | Memory Center |
| `DELETE /memories?confirm=true` · `GET /memories/export` · `POST /memories/consolidate` | bulk ops |
| `PUT /memory-settings` `{enabled}` | enable/disable memory |
| `GET /permissions` · `PUT /permissions/{CAP}` `{mode, minutes?}` | permissions |
| `GET/POST /trusted-rules` · `DELETE /trusted-rules/{id}` | trusted automation |
| `GET /actions/pending` · `POST /actions/{id}/confirm` · `POST /actions/{id}/reject` | confirmations |
| `GET /feed` · `GET /audit` · `GET /notifications` · `POST /notifications/{id}/read` | observability |
| `GET/POST /tasks` · `PATCH/DELETE /tasks/{id}` · `POST /tasks/{id}/pause|resume|run` · `GET /tasks/{id}/runs` | automation |
| `GET /tools` · `GET /agents` · `GET /integrations` | registries |
| `GET /system/hardware` · `GET /system/health` · `GET /system/events` | diagnostics |

Example:
```bash
curl -N -X POST localhost:8000/nexus/converse -H "Authorization: Bearer $T" \
  -H 'content-type: application/json' -d '{"text":"Recuérdame llamar a Juan en 30 minutos"}'
```
