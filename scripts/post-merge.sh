#!/usr/bin/env bash
set -euo pipefail

if [ -f app/backend/package.json ]; then
  echo "[post-merge] installing backend deps..."
  (cd app/backend && npm ci --no-audit --no-fund --prefer-offline)
  echo "[post-merge] building backend (tsc)..."
  (cd app/backend && npm run build)
fi

if [ -f app/frontend/package.json ]; then
  echo "[post-merge] installing frontend deps..."
  (cd app/frontend && npm ci --no-audit --no-fund --prefer-offline --legacy-peer-deps)
fi

echo "[post-merge] done."
