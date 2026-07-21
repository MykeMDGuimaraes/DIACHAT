---
name: Isolamento multi-tenant no DIA CHAT
description: Regra de escopo por companyId em services e CORS do socket
---
Regra: qualquer service que busca registro por id/uuid deve receber companyId (do JWT via req.user) e retornar 404 quando o registro não pertence à empresa — nunca confiar só no id. Isso vale também para mutações (update/delete/mediaUpload) e helpers que compõem listas a partir de ids (campanhas por tag).
**Why:** o fork Whaticket original tinha IDOR em ~15 services Show*/Delete*/Update* (auditoria+correção em jul/2026); revisão do architect achou furos extras nas mutações após corrigir só os Show*.
**How to apply:** ao criar/alterar endpoints, siga o padrão de ShowTicketService (where companyId + double-check). Socket.io CORS deriva de FRONTEND_URL (lista separada por vírgula); não voltar para "*". Rotas globais legítimas sem escopo: Help, Plan, Company (isSuper).
