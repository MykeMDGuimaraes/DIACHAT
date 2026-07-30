---
name: Envio aguarda reconexão do wbot
description: Como sends de ticket toleram reconexão Baileys e como testar módulos que importam baileys no jest
---
- Envios de ticket (texto/mídia) usam `GetTicketWbot(ticket, { waitForReconnectMs })` que espera a sessão voltar (sessão "pronta" = presente em `sessions` E `session.user` setado; sessão em QR não conta). Janela 45s (< timeouts de proxy) → `ERR_WAPP_NOT_AVAILABLE` 503, traduzido no frontend.
- **Why:** stream error 515 derruba o socket por ~minutos; falhar na hora perdia mensagens do atendente. 45s e não 60s para caber sob timeouts de proxy/axios.
- **How to apply:** operações auxiliares (read receipts etc.) devem manter `waitForReconnectMs` 0. Retry longo/idempotência é papel do pipeline Messaging v1 (branch codex/messaging-v1).
- Jest: qualquer spec que importe módulo que puxa `baileys` quebra com `crypto.subtle` — mock `jest.mock("baileys", () => ({ __esModule: true, default: {} }))` e mock com factory (não automock) helpers que puxam models/sequelize.
