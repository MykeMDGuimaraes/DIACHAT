---
name: Banco de teste do backend
description: Como rodar a suíte Jest do backend com banco PostgreSQL de teste isolado no Replit
---

O config Sequelize lê `DATABASE_URL`; o banco gerenciado aceita `CREATE DATABASE`. Criei `diachat_test` (`psql "$DATABASE_URL" -c "CREATE DATABASE diachat_test"`) e rodo migrações/Jest com `DATABASE_URL` reescrita para o path `/diachat_test` (NODE_ENV=test). O sequelize-cli usa `dist/` (.sequelizerc) — rode `npx tsc` antes de `sequelize db:migrate`.

**Why:** rodar testes destrutivos (`destroy({where:{}})`) no banco de dev é perigoso; e o `npm test` padrão apontaria para o mesmo banco.

Armadilha: FKs de migrações que criam tabelas em schema não-public precisam qualificar `model: { tableName, schema: "public" }`, senão `references: { model: "Companies" }` resolve para o schema da tabela nova e quebra em banco limpo (passa despercebido em bancos já migrados).
