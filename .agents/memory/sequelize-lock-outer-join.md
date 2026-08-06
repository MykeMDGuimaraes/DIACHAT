---
name: Sequelize FOR UPDATE com include quebra no Postgres
description: findOne com lock LOCK.UPDATE + include (LEFT JOIN) gera erro 0A000 no PostgreSQL; usar lock { level, of: Model } para travar só a tabela base
---

Regra: nunca combinar `lock: transaction.LOCK.UPDATE` com `include` de
associação opcional (LEFT OUTER JOIN) no Sequelize/PostgreSQL. O Postgres
recusa `FOR UPDATE` aplicado ao lado nulável de um outer join (erro 0A000:
"FOR UPDATE cannot be applied to the nullable side of an outer join") e a
request inteira vira 500.

**Why:** incidente real — envio pelo painel virava 500 genérico porque a
busca travada do Ticket incluía Contact; specs com dependências mockadas não
executam o SQL real e não pegaram.

**How to apply:** quando a trava for necessária junto de include, usar
`lock: { level: transaction.LOCK.UPDATE, of: ModelBase }` (gera
`FOR UPDATE OF "Tabela"`, permitido com joins). Antes de introduzir um lock
novo, validar contra o banco real (specs com deps mockadas não exercitam o
SQL gerado).
