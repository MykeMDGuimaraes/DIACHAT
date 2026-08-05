---
name: Banco de teste do backend
description: Suíte Jest do backend roda isolada no banco diachat_test, nunca no banco de dev
---

A suíte Jest roda isolada no banco `diachat_test` (seleção via `DB_NAME`, que tem prioridade sobre o path da `DATABASE_URL` no config Sequelize). O ciclo de teste cria, migra, semeia e derruba esse banco a cada execução.

**Why:** sem isolamento, suítes com operações destrutivas gravam e apagam dados do banco de dev.

**How to apply:** nunca rodar jest ou sequelize-cli de teste sem `DB_NAME` explícito — sem ele o comando opera no banco de dev. Migrações e seeds executados pelo sequelize-cli usam o código compilado, então é preciso recompilar após alterá-los. FKs de migrações que criam tabelas em schema não-public precisam qualificar o schema da tabela referenciada, senão quebram em banco limpo.
