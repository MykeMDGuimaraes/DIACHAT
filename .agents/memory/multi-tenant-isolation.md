---
name: Isolamento multi-tenant no DIA CHAT
description: Regra de escopo por companyId em services e CORS do socket
---
Regra: qualquer service que busca registro por id/uuid deve receber companyId (do JWT via req.user) e retornar 404 quando o registro não pertence à empresa — nunca confiar só no id. Vale também para mutações (update/delete/mediaUpload), mensagens de chat interno e helpers que compõem listas a partir de ids (campanhas por tag).
**Why:** o fork Whaticket original expõe IDOR sistematicamente: services Show*/Update*/Delete* buscam por PK sem checar tenant; corrigir só as leituras não basta, as mutações têm os mesmos furos.
**How to apply:** siga o padrão de ShowTicketService (where com companyId + double-check). Socket.io CORS deriva de FRONTEND_URL (lista separada por vírgula); não voltar para "*". Rotas globais legítimas sem escopo: Help, Plan, Company (isSuper).
