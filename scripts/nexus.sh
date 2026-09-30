#!/usr/bin/env bash
# NEXUS developer helper:  ./scripts/nexus.sh install|configure|start|test|build|e2e
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${NEXUS_VENV:-$ROOT/backend/.venv}"
PY="$VENV/bin/python"

case "${1:-help}" in
  install)
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q -r "$ROOT/backend/requirements.txt" pytest pytest-asyncio psutil
    (cd "$ROOT/frontend" && npm install --no-audit --no-fund)
    echo "✓ installed (venv: $VENV)";;
  configure)
    if [ ! -f "$ROOT/.env" ]; then cp "$ROOT/.env.example" "$ROOT/.env"; echo "✓ created .env from .env.example"; fi
    if ! grep -q "^JWT_SECRET=please-change" "$ROOT/.env"; then :; else
      secret=$(python3 -c "import secrets;print(secrets.token_urlsafe(48))")
      sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" "$ROOT/.env" && rm -f "$ROOT/.env.bak"
      echo "✓ generated a random JWT_SECRET"
    fi
    echo "Edit .env to add OLLAMA_BASE_URL or provider keys (optional — NEXUS runs in dev-mock mode without them).";;
  start)
    cd "$ROOT/backend"
    set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
    SERVICE=devserver DEV_INMEMORY=1 DATABASE_URL="${NEXUS_DATABASE_URL:-sqlite+aiosqlite:///./nexus_dev.db}" \
      CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}" "$PY" -m uvicorn run:app --port 8000 &
    BACK=$!
    trap 'kill $BACK 2>/dev/null' EXIT
    cd "$ROOT/frontend" && NEXT_PUBLIC_API_URL=http://localhost:8000 npx next dev -p 3000;;
  test)
    (cd "$ROOT/backend" && "$PY" -m pytest -q)
    (cd "$ROOT/frontend" && npx tsc --noEmit -p . && npm run test:nexus);;
  build)
    (cd "$ROOT/frontend" && npx next build);;
  e2e)
    (cd "$ROOT/frontend" && npm run e2e:nexus);;
  *)
    echo "usage: $0 install|configure|start|test|build|e2e";;
esac
