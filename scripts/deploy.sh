#!/bin/bash
# Deploy docmost using docker compose.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.production.yml"

echo "=== Docmost Deploy ==="

# ── Step 1: Build and deploy ──
echo "[1/3] Building and deploying..."
docker compose -f "$COMPOSE_FILE" up --build -d

# ── Step 2: Health check ──
echo "[2/3] Waiting for services to be healthy (max 3min)..."
for i in $(seq 1 36); do
  unhealthy=$(docker compose -f "$COMPOSE_FILE" ps | grep -cE "starting|unhealthy|Exit" || true)
  if [ "$unhealthy" -eq 0 ]; then
    running=$(docker compose -f "$COMPOSE_FILE" ps --status running -q | wc -l)
    if [ "$running" -ge 2 ]; then
      echo "All services are healthy."
      break
    fi
  fi
  if [ "$i" -eq 36 ]; then
    echo "ERROR: Services did not become healthy within 180s"
    docker compose -f "$COMPOSE_FILE" ps
    exit 1
  fi
  echo "  attempt $i/36 — waiting 5s..."
  sleep 5
done

# ── Step 3: Cleanup old images ──
echo "[3/3] Pruning dangling images..."
docker image prune -f --filter "until=24h" 2>/dev/null || true

echo "Deploy complete."
