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

echo "[replit-start] ensuring Kanban/CRM enabled on free plan (id=4)..."
PGPASSWORD="${DB_PASS:-password}" psql -h "${DB_HOST:-helium}" -U "${DB_USER:-postgres}" -d "${DB_NAME:-heliumdb}" -c "UPDATE \"Plans\" SET \"useKanban\" = true WHERE id = 4;" || echo "[replit-start] could not flip useKanban on plan 4, continuing."

echo "[replit-start] starting backend..."
exec npm start
