#!/usr/bin/env bash
# Build de produção do DIA CHAT (backend + frontend em uma única porta).
set -e
cd "$(dirname "$0")/.."

echo "[deploy-build] compilando backend (tsc)..."
cd app/backend
if [ ! -d node_modules ]; then
  npm install --force
fi
npm run build

echo "[deploy-build] compilando frontend (CRA build, mesma origem)..."
cd ../frontend
if [ ! -d node_modules ]; then
  npm install --force --legacy-peer-deps
fi
# Reaplica os patches idempotentes de node_modules (uuid, eslint-scope, etc.)
bash replit-start.sh --patches-only || true
# Em produção o frontend é servido pelo próprio backend => URLs relativas.
# GENERATE_SOURCEMAP=false + heap 2560MB: única combinação que compila sem OOM
# neste ambiente (validado em 22/07/2026).
REACT_APP_BACKEND_URL="" \
  GENERATE_SOURCEMAP=false \
  NODE_OPTIONS="--openssl-legacy-provider --max-old-space-size=2560" \
  npx react-scripts build

echo "[deploy-build] concluído."
