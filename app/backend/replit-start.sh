#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules ]; then
  echo "[replit-start] installing backend deps..."
  npm install --force
fi

echo "[replit-start] building TypeScript..."
npm run build

echo "[replit-start] running migrations..."
npx sequelize db:migrate

echo "[replit-start] running seeds (idempotent; failures ignored if already seeded)..."
npx sequelize db:seed:all || echo "[replit-start] seeds already applied, continuing."

echo "[replit-start] starting backend..."
exec npm start
