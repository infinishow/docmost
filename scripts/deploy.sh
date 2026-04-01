#!/bin/bash
# Deploy docmost using docker compose.
# Usage: bash scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Docmost Deploy ==="

# ── Step 1: Build and deploy ──
echo "[1/2] Building and deploying..."
docker compose -f docker-compose.production.yml up --build -d

# ── Step 2: Health check ──
echo "[2/2] Waiting for services to be healthy (max 3min)..."
for i in $(seq 1 36); do
  if ! docker compose -f docker-compose.production.yml ps | grep -qE "starting|unhealthy"; then
    echo "All services are healthy."
    exit 0
  fi
  if [ "$i" -eq 36 ]; then
    echo "ERROR: Services did not become healthy within 180s"
    docker compose -f docker-compose.production.yml ps
    exit 1
  fi
  echo "  attempt $i/36 — waiting 5s..."
  sleep 5
done
