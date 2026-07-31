---
name: Preflight de produção do deploy
description: Variáveis exigidas pelo DeploymentPreflight no boot de produção e onde elas vivem
---
O deploy VM roda `dist/operations/DeploymentPreflight.js` antes de iniciar; se falhar, o app nunca fica "ready" e o publish falha no health check **sem logs de runtime visíveis**.
- Exige: JWT_SECRET≠JWT_REFRESH_SECRET (≥32 bytes), API_KEY_PEPPER, MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER, MESSAGING_ENCRYPTION_ACTIVE_KEY_ID + MESSAGING_ENCRYPTION_KEY_<ID> (base64 de 32 bytes), META_GRAPH_VERSION (vN.N), URLs https, DATABASE_URL com sslmode=require.
- Produção lê esses valores do `app/backend/.env` (gitignored, mas embarcado na imagem do deploy) — não dos Replit Secrets.
**How to apply:** quando um merge adicionar variáveis novas ao preflight, gere/adicione no `.env` e valide localmente com `NODE_ENV=production ... node dist/operations/DeploymentPreflight.js` (dummy DATABASE_URL/URLs) antes de republicar.
**Why:** publish de 2026-07-28 falhou no promote sem logs; causa era preflight exigindo os novos gates do Messaging v1.

## Falhas de promote com "failed to push referrer manifest" (HTTP 500)
Se o build compila, a imagem sobe, mas aparece `error: failed to push referrer manifest ... registry returned retryable HTTP status 500` seguido de "Waiting for deployment to be ready" até falhar **sem nenhum log de runtime**: é instabilidade do registry da Replit, não do app. Como confirmar: o app nunca iniciou (ex.: banco de produção sem as migrações pendentes, `fetchDeploymentLogs` vazio). O retry do push às vezes passa (build fica "success") — republicar costuma resolver; persistindo, abrir suporte com o build ID.
**Why:** 2026-07-28 — dois builds seguidos falharam assim; validação local completa (preflight + migrações + boot) passou e o banco de produção provou que o deploy-run nunca executou.

## Falha silenciosa no push de camadas (sem linha de erro)
Terceira assinatura de falha de publish: build log para abruptamente após "Created hosting layer" (com "Pushing Repl layer" sem o "Created Repl layer" correspondente) e o build vira `failed` ~20s depois, **sem nenhuma linha de erro** e sem "Creating virtual machine". Método de diagnóstico: comparar o rabo do build log com o do último build `success` — as etapas de promote são "Pushed image manifest" → "Creating virtual machine" → "Waiting for deployment to be ready" → "Deployment successful". Onde o log parou diz quem é o culpado: parou antes de "Creating virtual machine" = plataforma (retry); chegou em "Waiting for deployment to be ready" = app/preflight/migração (nosso lado). `fetchDeploymentLogs` vazio NÃO distingue os dois casos — containers que falham no promote não deixam runtime log de qualquer forma.
**Why:** 2026-07-31 — build 7b583d65 falhou assim; preflight local passou, nada mudou nos scripts de deploy, e a comparação com o build bom provou que a VM nem foi criada (publish transitório, retry recomendado).
