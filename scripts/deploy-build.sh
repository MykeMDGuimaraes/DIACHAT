#!/usr/bin/env bash
# Build de produção do DIA CHAT (backend + frontend em uma única porta).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[deploy-build] instalando backend a partir do lockfile..."
cd app/backend
npm ci --no-audit --no-fund

echo "[deploy-build] compilando backend (tsc)..."
npm run build

echo "[deploy-build] instalando frontend a partir do lockfile..."
cd ../frontend
npm ci --legacy-peer-deps --no-audit --no-fund

# Reaplica os patches idempotentes de node_modules (uuid, eslint-scope, etc.)
bash replit-start.sh --patches-only

echo "[deploy-build] compilando frontend (CRA build, mesma origem)..."
# Em produção o frontend é servido pelo próprio backend => URLs relativas.
# GENERATE_SOURCEMAP=false + heap 2560MB: única combinação que compila sem OOM
# neste ambiente (validado em 22/07/2026).
REACT_APP_BACKEND_URL="" \
  GENERATE_SOURCEMAP=false \
  NODE_OPTIONS="--openssl-legacy-provider --max-old-space-size=2560" \
  ./node_modules/.bin/react-scripts build

echo "[deploy-build] concluído."
