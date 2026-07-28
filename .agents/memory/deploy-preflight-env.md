---
name: Preflight de produção do deploy
description: Variáveis exigidas pelo DeploymentPreflight no boot de produção e onde elas vivem
---
O deploy VM roda `dist/operations/DeploymentPreflight.js` antes de iniciar; se falhar, o app nunca fica "ready" e o publish falha no health check **sem logs de runtime visíveis**.
- Exige: JWT_SECRET≠JWT_REFRESH_SECRET (≥32 bytes), API_KEY_PEPPER, MESSAGING_WEBHOOK_VERIFY_TOKEN_PEPPER, MESSAGING_ENCRYPTION_ACTIVE_KEY_ID + MESSAGING_ENCRYPTION_KEY_<ID> (base64 de 32 bytes), META_GRAPH_VERSION (vN.N), URLs https, DATABASE_URL com sslmode=require.
- Produção lê esses valores do `app/backend/.env` (gitignored, mas embarcado na imagem do deploy) — não dos Replit Secrets.
**How to apply:** quando um merge adicionar variáveis novas ao preflight, gere/adicione no `.env` e valide localmente com `NODE_ENV=production ... node dist/operations/DeploymentPreflight.js` (dummy DATABASE_URL/URLs) antes de republicar.
**Why:** publish de 2026-07-28 falhou no promote sem logs; causa era preflight exigindo os novos gates do Messaging v1.
