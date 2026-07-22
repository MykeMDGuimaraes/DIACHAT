#!/usr/bin/env bash
# Execução em produção (deployment VM): Redis local + migrações + backend
# servindo também o frontend compilado, tudo em uma única porta.
set -e
cd "$(dirname "$0")/.."

echo "[deploy-run] iniciando Redis local..."
redis-server --port 6379 --bind 127.0.0.1 --save '' --appendonly no --daemonize yes

cd app/backend

# Em produção o banco vem de DATABASE_URL (Postgres de produção do Replit).
# Exportamos DB_* aqui para que tenham precedência sobre o .env de
# desenvolvimento carregado pelo dotenv (que aponta para o banco local).
if [ -n "${DATABASE_URL:-}" ]; then
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
fi

# URL pública de produção (REPLIT_DOMAINS contém o domínio publicado).
PROD_DOMAIN="${REPLIT_DOMAINS%%,*}"
if [ -n "$PROD_DOMAIN" ]; then
  export FRONTEND_URL="https://${PROD_DOMAIN}"
  export BACKEND_URL="https://${PROD_DOMAIN}"
fi

export NODE_ENV=production
export PORT="${PORT:-3001}"
export REDIS_URI="${REDIS_URI:-redis://127.0.0.1:6379}"
export PROXY_PORT=443

echo "[deploy-run] executando migrações..."
npx sequelize db:migrate

# Seeds só rodam quando explicitamente habilitados (primeiro deploy), para não
# mascarar erros reais em todo restart. Defina RUN_SEEDS=true nos secrets de
# produção na primeira publicação e remova depois.
if [ "${RUN_SEEDS:-}" = "true" ]; then
  echo "[deploy-run] executando seeds (RUN_SEEDS=true)..."
  npx sequelize db:seed:all
else
  echo "[deploy-run] seeds ignorados (defina RUN_SEEDS=true para rodar)."
fi

echo "[deploy-run] iniciando backend na porta ${PORT}..."
exec node dist/server.js
