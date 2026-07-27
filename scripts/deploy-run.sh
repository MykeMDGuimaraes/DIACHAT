#!/usr/bin/env bash
# Execução em produção (deployment VM): Redis local + migrações + backend
# servindo também o frontend compilado, tudo em uma única porta.
set -euo pipefail
cd "$(dirname "$0")/.."

export NODE_ENV=production
export PORT="${PORT:-3001}"
export REDIS_URI="${REDIS_URI:-redis://127.0.0.1:6379}"
export PROXY_PORT=443

# URL pública de produção (REPLIT_DOMAINS contém o domínio publicado).
PROD_DOMAIN="${REPLIT_DOMAINS:-}"
PROD_DOMAIN="${PROD_DOMAIN%%,*}"
if [ -n "$PROD_DOMAIN" ]; then
  export FRONTEND_URL="https://${PROD_DOMAIN}"
  export BACKEND_URL="https://${PROD_DOMAIN}"
fi

cd app/backend

echo "[deploy-run] validando configuração de produção..."
node dist/operations/DeploymentPreflight.js

# Em produção o banco vem de DATABASE_URL (Postgres de produção do Replit).
# Exportamos DB_* somente depois do preflight, evitando fallback para .env local
# e evitando que uma URL inválida seja impressa por um parser antes da validação.
eval "$(node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = (s) => "\x27" + String(s).replace(/\x27/g, "\x27\\\x27\x27") + "\x27";
  console.log("export DB_HOST=" + q(u.hostname));
  console.log("export DB_PORT=" + q(u.port || "5432"));
  console.log("export DB_NAME=" + q(u.pathname.replace(/^\//, "")));
  console.log("export DB_USER=" + q(decodeURIComponent(u.username)));
  console.log("export DB_PASS=" + q(decodeURIComponent(u.password)));
  if (u.searchParams.get("sslmode") === "require") console.log("export DB_SSL=true");
')"

if [[ "$REDIS_URI" == "redis://127.0.0.1:"* || "$REDIS_URI" == "redis://localhost:"* ]]; then
  if ! redis-cli -u "$REDIS_URI" ping >/dev/null 2>&1; then
    echo "[deploy-run] iniciando Redis local..."
    redis-server --port 6379 --bind 127.0.0.1 --save '' --appendonly no --daemonize yes
  fi
fi

echo "[deploy-run] aguardando Redis..."
for _ in $(seq 1 20); do
  if redis-cli -u "$REDIS_URI" ping 2>/dev/null | grep -q '^PONG$'; then
    break
  fi
  sleep 0.25
done
if ! redis-cli -u "$REDIS_URI" ping 2>/dev/null | grep -q '^PONG$'; then
  echo "[deploy-run] Redis indisponível." >&2
  exit 1
fi

echo "[deploy-run] executando migrações..."
./node_modules/.bin/sequelize db:migrate

# Seeds só rodam quando explicitamente habilitados (primeiro deploy), para não
# mascarar erros reais em todo restart. Defina RUN_SEEDS=true nos secrets de
# produção na primeira publicação e remova depois.
if [ "${RUN_SEEDS:-}" = "true" ]; then
  echo "[deploy-run] executando seeds (RUN_SEEDS=true)..."
  ./node_modules/.bin/sequelize db:seed:all
else
  echo "[deploy-run] seeds ignorados (defina RUN_SEEDS=true para rodar)."
fi

echo "[deploy-run] iniciando backend na porta ${PORT}..."
exec node dist/server.js
