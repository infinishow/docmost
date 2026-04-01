#!/bin/bash
# Verify docmost deployment is fully operational.
# Run from the project root after deploy.
set -uo pipefail

cd "$(dirname "$0")/.."

PASS=0
FAIL=0

check() {
  local name="$1"
  local ok="$2"
  if [ "$ok" = "1" ]; then
    printf "  \033[32mPASS\033[0m  %s\n" "$name"
    PASS=$((PASS + 1))
  else
    printf "  \033[31mFAIL\033[0m  %s\n" "$name"
    FAIL=$((FAIL + 1))
  fi
}

if [ -f .env ]; then
  set -a && source .env && set +a
fi
PORT="${DOCMOST_PORT:-13000}"
COMPOSE_FILE="docker-compose.production.yml"

echo "=== Docmost Deployment Verification ==="
echo ""

# ── Services ──
echo "[Services]"

for svc in docmost redis; do
  container_id=$(docker compose -f "$COMPOSE_FILE" ps -q "$svc" 2>/dev/null || true)
  if [ -n "$container_id" ]; then
    health=$(docker inspect --format='{{.State.Health.Status}}' "$container_id" 2>/dev/null || echo "none")
    [ "$health" = "healthy" ] && check "$svc — healthy" 1 || check "$svc — $health" 0
  else
    check "$svc — not running" 0
  fi
done

# ── HTTP ──
echo ""
echo "[HTTP]"

http_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${PORT}/api/health" 2>/dev/null || echo "000")
[ "$http_code" = "200" ] && check "GET /api/health → 200" 1 || check "GET /api/health → $http_code (expected 200)" 0

# ── Storage ──
echo ""
echo "[Storage]"

storage_ok=0
if docker compose -f "$COMPOSE_FILE" exec -T docmost test -d "/app/data/storage" 2>/dev/null; then
  storage_ok=1
fi
check "storage volume mounted" "$storage_ok"

# ── Database connectivity ──
echo ""
echo "[Database]"

db_ok=0
db_check=$(docker compose -f "$COMPOSE_FILE" exec -T docmost node -e "
const { Client } = require('pg');
const c = new Client(process.env.DATABASE_URL);
c.connect().then(() => c.query('SELECT 1')).then(() => { console.log('ok'); c.end(); }).catch(e => { console.log('fail: ' + e.message); c.end(); });
" 2>/dev/null || echo "fail")
if echo "$db_check" | grep -q "ok"; then
  db_ok=1
fi
check "database connection" "$db_ok"

# ── Summary ──
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
