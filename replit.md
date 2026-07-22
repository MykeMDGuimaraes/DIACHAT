# DIA CHAT

## Overview
DIA CHAT (fork AtendeChat/Whaticket) — plataforma de atendimento multi-tenant da Dia Solutions, em PT-BR. Backend Express/TypeScript na porta 3001, frontend CRA React na porta 5000, PostgreSQL e Redis. Serve como backend-core multi-tenant e BFF para o Hub Fala Caminhoneiro.

## API interna /internal/v1
- Autenticação por credencial de serviço (`Bearer tokenId.secret`), escopada por tenant (companyId).
- Recursos: contacts, conversations, messages (paginação por cursor), envio idempotente (`clientMessageId`) e canal de eventos SSE `GET /internal/v1/events` (cursor via `?cursor=` ou `Last-Event-ID`; `cursor=0` = somente ao vivo; evento `resync` quando o cursor sai da janela de retenção).
- Credenciais: `POST /service-credentials` (super admin); token exibido apenas na criação.
- Guia de integração para o time do Hub (BFF + frontend): `docs/INTEGRACAO_HUB.md` (PT-BR, autossuficiente, com exemplos reais).

## Auditoria
- Tabela `AuditLogs` (tenant, ator, ação, alvo, outcome, ip, metadata) — somente identificadores, nunca conteúdo de mensagens.
- Ações auditadas: `auth.login`, `service.auth`, `v1.message.send`, `media.access`, `service_credential.create/revoke`.
- Consulta via SQL, ex.: `SELECT * FROM "AuditLogs" ORDER BY id DESC LIMIT 50;`

## Testes de isolamento multi-tenant
- Comando único (com o workflow Backend rodando): `cd app/backend && npm run test:isolation`
- O script `app/backend/scripts/isolationTests.js` cria dois tenants de teste (ISO-TEST-A/B), valida acesso cruzado em REST v1, eventos SSE, anexos `/public` e caminho por UUID, além de idempotência, paginação por cursor e trilha de auditoria. Limpa e recria os fixtures a cada execução.

## Publicação (deployment)
- Alvo: VM (estado persistente — sessões WhatsApp, Redis, campanhas). Build: `scripts/deploy-build.sh`; run: `scripts/deploy-run.sh`.
- Em produção tudo roda numa única origem: backend serve o build do frontend (`app/frontend/build`) com fallback SPA; frontend compilado com `REACT_APP_BACKEND_URL=""` (URLs relativas).
- Banco: produção usa `DATABASE_URL` (deploy-run exporta `DB_*` a partir dela, com SSL quando `sslmode=require`). Redis roda local dentro da VM.
- Seeds: só no primeiro deploy — definir secret `RUN_SEEDS=true` na primeira publicação e remover depois. Migrações rodam sempre.

## User preferences
- Comunicação e artefatos em PT-BR.
