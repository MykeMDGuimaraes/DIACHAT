---
name: Deploy env snapshot + seeds não-idempotentes
description: Mudança de env var de produção só vale em deployment NOVO; seeds no boot precisam de guard de idempotência ou viram crash loop
---

- Variáveis de ambiente de produção são capturadas na **criação do deployment**. Editar/remover uma var NÃO afeta um deployment já criado — inclusive um em crash loop. Para aplicar a mudança é preciso republicar.
- `scripts/deploy-run.sh` roda seeds quando `RUN_SEEDS=true`; os seeders legados (`20200904070005-create-default-company` etc.) NÃO são idempotentes (insert direto de "Plano 1"). Se o boot morre depois de semear (ex.: timeout ao abrir a porta) e RUN_SEEDS segue ativo, todo retry aborta em chave duplicada (`set -euo pipefail`) → crash loop com o site fora do ar.

**Why:** incidente real (ago/2026): wipe de produção + re-seed — a primeira tentativa semeou com sucesso mas foi morta antes de abrir a porta; o deploy ficou em crash loop (seed duplicado a cada retry) até republicar sem RUN_SEEDS. Remover a var sozinha não destravou o loop.

**How to apply:** (1) manter o guard em deploy-run.sh que pula seeds quando `Plans` já tem linhas (checagem via pg com DB_* exportadas; falha na checagem → pula seeds por segurança, site sobe mesmo assim); (2) ao usar RUN_SEEDS em produção, remover a var E republicar assim que o seed completar; (3) qualquer nova etapa de boot que escreva no banco precisa ser idempotente ou guardada.
