# ADR 0001 — Mensageria como monólito modular

- Status: aceito
- Data: 2026-07-24

## Contexto

A V1 opera em uma única Reserved VM de 4 vCPU/8 GB, com PostgreSQL compartilhado e até 20 conexões WhatsApp. Um segundo runtime NestJS/Fastify/Prisma/PM2 não entregaria isolamento ou escala física nesse ambiente e acrescentaria outro ORM, migrador, pool e ciclo de shutdown.

## Decisão

Mensageria permanece em `app/backend/src/messaging`, no processo Express/Sequelize existente. A separação é garantida por contratos internos e pelo gate de CI que impede imports/envios Baileys fora do adapter. PostgreSQL é a fonte de verdade; Redis não participa da garantia de durabilidade.

## Gatilho para extração física

A extração para serviço/processo separado só será reavaliada quando pelo menos um dos seguintes sinais persistir:

- necessidade comprovada de mais de 20 conexões simultâneas por VM;
- p95 acima do SLO definido no capacity gate durante sete dias consecutivos, apesar de otimização do monólito;
- necessidade operacional real de deploy ou escala independente;
- isolamento de falha que só possa ser obtido em máquina distinta.

Antes da extração, é obrigatório haver resultado reproduzível do capacity gate, orçamento de memória, plano de pools/migrações e estratégia de ownership de sessões. A fronteira atual de adapters, contratos e schema foi desenhada para tornar essa mudança de infraestrutura possível sem reescrever o domínio.

## Consequências

Há um framework HTTP, um ORM, um migrador e um supervisor. O fluxo público grava contato, ticket, mensagem, comando e outbox em uma transação local; o dispatcher chama o adapter depois do commit. A futura extração deverá preservar esses contratos e as semânticas de idempotência/`unknown`.
