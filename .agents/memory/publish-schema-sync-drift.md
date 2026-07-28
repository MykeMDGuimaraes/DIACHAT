---
name: Drift de schema no publish (colunas sem SequelizeMeta)
description: Publish da Replit pode adicionar colunas em tabelas existentes de prod sem registrar migrações — migrações novas precisam ser idempotentes
---

O fluxo de publish da Replit (sync de schema dev→prod) pode aplicar mudanças estruturais em tabelas **existentes** de produção (ex.: addColumn) sem gravar nada no `SequelizeMeta`. Tabelas **novas** não são criadas por esse sync — ficam para as migrações do `deploy-run.sh`.

**Sintoma:** deploy em crash loop com `ERROR: column "X" of relation "Y" already exists` logo após um publish que envolve mudança de schema; a migração correspondente consta como pendente no `SequelizeMeta` de prod.

**Why:** o sync copia estrutura do banco de dev mas não o histórico de migrações; a migração seguinte tenta recriar a coluna e aborta o startup inteiro (preflight → migrações → servidor).

**How to apply:**
- Migrações que tocam tabelas existentes (addColumn/addIndex) devem ser idempotentes: guard com `describeTable`, `to_regclass('schema."Tabela"')` e `pg_indexes` antes de cada operação. UPDATEs de backfill devem ter `WHERE ... IS NULL`.
- Antes de republicar com migrações pendentes, comparar em prod (somente leitura) as colunas-alvo das migrações com `information_schema.columns` para detectar drift e evitar ciclo de falhas publish→crash→fix.
- Não "resolver" marcando a migração como aplicada no SequelizeMeta se ela também cria tabelas/índices novos — parte da migração ficaria sem executar.
