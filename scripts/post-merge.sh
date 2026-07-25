#!/usr/bin/env bash
set -e

npm_install() {
  # Clean up stale npm temp rename dirs (cause ENOTEMPTY on rename) and retry once.
  (
    cd "$1"
    rm -rf node_modules/.*-????????/ 2>/dev/null || true
    npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps || {
      echo "[post-merge] npm install failed in $1, cleaning temp dirs and retrying..."
      rm -rf node_modules/.*-????????/ 2>/dev/null || true
      npm install --no-audit --no-fund --prefer-offline --legacy-peer-deps
    }
  )
}

if [ -f app/backend/package.json ]; then
  echo "[post-merge] installing backend deps..."
  npm_install app/backend
  echo "[post-merge] building backend (tsc)..."
  (cd app/backend && npm run build)
fi

if [ -f app/frontend/package.json ]; then
  echo "[post-merge] installing frontend deps..."
  npm_install app/frontend
fi

echo "[post-merge] done."
