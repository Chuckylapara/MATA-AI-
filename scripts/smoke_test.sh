#!/usr/bin/env bash
# End-to-end smoke test against a running stack (docker compose up).
# Exercises auth -> chat -> image -> agent -> billing -> admin in mock mode.
set -euo pipefail

API="${API:-http://localhost:8000}"
EMAIL="smoke_$(date +%s)@mata.ai"

echo "1) Register"
TOK=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
AUTH="Authorization: Bearer $TOK"

echo "2) Chat"
curl -s -X POST "$API/chat/completions" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello Mata"}]}' | head -c 300; echo

echo "3) Image"
curl -s -X POST "$API/image/generations" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"prompt":"a neon city","n":1}' | head -c 200; echo

echo "4) Agent"
curl -s -X POST "$API/agent/runs" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"goal":"what is 21 * 2"}'; echo

echo "5) Billing (mock upgrade to pro)"
curl -s -X POST "$API/billing/checkout" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"tier":"pro"}'; echo

echo "6) Admin overview (login as seeded admin)"
ADMIN_TOK=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"admin@mata.ai","password":"admin12345"}' | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "$API/admin/overview" -H "Authorization: Bearer $ADMIN_TOK"; echo

echo "Smoke test complete."
