#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[replit-start] installing frontend deps..."
  npm install --force --legacy-peer-deps
fi

export HOST=0.0.0.0
export PORT=5000
export DANGEROUSLY_DISABLE_HOST_CHECK=true
export BROWSER=none

echo "[replit-start] starting CRA dev server on :$PORT..."
exec npm start
