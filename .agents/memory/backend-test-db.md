---
name: Banco de teste do backend
description: Como rodar a suíte Jest do backend com banco PostgreSQL de teste isolado no Replit
---

O config Sequelize lê `DATABASE_URL`; o banco gerenciado aceita `CREATE DATABASE`. Criei `diachat_test` (`psql "$DATABASE_URL" -c "CREATE DATABASE diachat_test"`) e rodo migrações/Jest com `DATABASE_URL` reescrita para o path `/diachat_test` (NODE_ENV=test). O sequelize-cli usa `dist/` (.sequelizerc) — rode `npx tsc` antes de `sequelize db:migrate`.

Receita confirmada: `NODE_ENV=test` faz o bootstrap carregar `.env.test` (que aponta para diachat_test); para rodar o CLI contra um banco arbitrário, passe `DB_NAME=<banco>` explicitamente junto com a DATABASE_URL reescrita — só a URL inline pode não bastar (o config dá prioridade a `DB_NAME` e o bootstrap carrega .env).

**Why:** rodar testes destrutivos (`destroy({where:{}})`) no banco de dev é perigoso; e o `npm test` padrão apontaria para o mesmo banco.

Incidente de 03/08/2026: neste repl, rodar `npx jest` (bare OU com `NODE_ENV=test`) gravou no banco de DEV — suítes de integração criaram empresas/canais "Canal Outbound <uuid>" e comandos fantasmas (que o backend vivo despachou de verdade), e limpezas das suítes apagaram MessageCommands reais. A isolação via `.env.test` descrita acima não estava ativa. Até o isolamento ser corrigido: após rodar suítes, conferir e limpar `Companies`/`Whatsapps`/`messaging."MessageCommands"` fixture (empresas com id alto e canais "Canal Outbound %").

Armadilha: FKs de migrações que criam tabelas em schema não-public precisam qualificar `model: { tableName, schema: "public" }`, senão `references: { model: "Companies" }` resolve para o schema da tabela nova e quebra em banco limpo (passa despercebido em bancos já migrados).
