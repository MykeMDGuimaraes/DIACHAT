# Runbook operacional — entrega WhatsApp (Hardening T1–T7)

Guia para atendente/administrador diagnosticar e agir sobre os sinais de
entrega expostos pelo hardening. **Nenhum procedimento aqui reenvia mensagens
automaticamente nem apaga credenciais sem autorização.**

## Princípios

- **Nunca reenviar automaticamente.** O runtime marca comandos não
  confirmados como `unknown`; um ACK tardio os cura sozinho. Reenvio manual
  duplica mensagem para o cliente.
- **Credencial é sagrada.** Limpar `session`/chaves de pareamento desconecta
  o número e exige novo QR. Só com autorização explícita do responsável.
- **Logs e métricas nunca contêm telefone, JID, corpo de mensagem ou
  segredos** — o logger redige esses campos. Diagnostique por `companyId`,
  `whatsappId`, `generation`, `commandId` e códigos normalizados.

## Sinais (métricas em processo + logs estruturados)

| Métrica | Significado |
| --- | --- |
| `active_socket_count` | Sockets ativos no canal (normal: 0 ou 1) |
| `connect_attempt_total` | Tentativas de conexão iniciadas |
| `reconnect_total` (por `reasonCode`) | Reconexões agendadas, por motivo normalizado |
| `stale_callback_total` | Callbacks de geração antiga suprimidos pelo fencing |
| `auth_write_failure_total` | Falhas ao persistir credencial/chaves |
| `auth_revision_conflict_total` | Escritas de chave rejeitadas pelo fencing (rev/geração mais nova venceu) |
| `delivery_unconfirmed_total` | Envios sem ACK confirmado na janela |
| `ack_latency_ms` | Latência criação → ACK do servidor (count/sum/max) |

Eventos aparecem nos logs do backend como `delivery-metric` (debug) e
`delivery-alert` (warn/error), sempre com ids e códigos — nunca PII. Os
agregados em processo são exportados no endpoint operacional de métricas do
módulo de mensageria (`MessagingMetricsService.collect`, chave
`deliverySignals`: counters, gauges e `ackLatencyMs`).

## Alertas

| Alerta (`delivery-alert`) | Severidade | Significado | Ação |
| --- | --- | --- | --- |
| `duplicate_active_socket` | **crítico** | Mais de um socket ativo no canal — regressão do invariante do SessionManager | Isolar o canal (parar sessão pelo painel), coletar logs com `generation` e escalar. Não reconectar em loop. |
| `stale_write_accepted` | **crítico** | Escrita de credencial aplicada com revisão não crescente — impossível por construção | Escalar imediatamente com os logs (`whatsappId`, `revision`); indica bug na fila de escrita. |
| `delivery_unconfirmed_threshold` | **crítico** | Mais de duas entregas não confirmadas em 10 minutos no canal; canal marcado `degraded` | Verificar conectividade do número (sessão degradada = re-parear). Fazer **teste controlado**: uma mensagem para contato de teste, observando `delivery_unconfirmed_total` e `ack_latency_ms`. |
| `stream_replacement_warning` | aviso | WhatsApp encerrou/substituiu a stream (status 440/463) | Verificar se outro aparelho/instância assumiu o número. Não reconectar em loop — a policy já trata. |
| `terminal_session` | aviso | Sessão terminal (logout, restrição) conforme policy de desconexão | Se `clearCredential=true`, o pareamento foi encerrado: novo QR necessário. Se 440 (`CONNECTION_REPLACED`), a credencial continua válida. |

## Procedimentos seguros

1. **Canal degradado (`delivery_unconfirmed_threshold`)**
   - Confirmar no painel que a sessão consta conectada.
   - Enviar **uma** mensagem de teste controlada para contato interno.
   - Observar os logs por `ack_latency_ms` e ausência de novo
     `delivery_unconfirmed_total` para o `whatsappId`.
   - Persistindo por >10 min: tratar como sessão degradada — re-parear o
     canal (novo QR) com autorização do responsável.

2. **`stale_callback_total` crescendo**
   - Normal em picos durante reconexão (callbacks antigos suprimidos).
   - Contínuo sem reconexão em andamento: verificar se há mais de um
     processo/replica servindo o mesmo canal (a lease impede, mas confirme
     `active_socket_count`).

3. **`auth_write_failure_total` > 0**
   - Verificar saúde do PostgreSQL (a fila de escrita faz falha fechada).
   - Três falhas consecutivas no canal acionam a política de falha
     persistente: o canal é derrubado de forma controlada (ver logs
     `auth-state-writer`).

4. **Limpeza de credencial** — somente com autorização explícita:
   ```sql
   -- SOMENTE com autorização. Desconecta o número (novo QR necessário).
   UPDATE "Whatsapps" SET session = '', status = 'PENDING'
   WHERE id = :whatsappId;
   -- Cache Baileys legado:
   DELETE FROM "Baileys" WHERE "whatsappId" = :whatsappId;
   -- Chaves cifradas (T6) — apaga TODO o material de pareamento do canal:
   DELETE FROM messaging."WhatsAppSessionKeys" WHERE "whatsappId" = :whatsappId;
   ```

## Queries de diagnóstico (sem conteúdo de mensagem nem segredos)

```sql
-- Entregas não confirmadas aguardando ACK (unknown), por canal:
SELECT "whatsappId", COUNT(*) AS pendentes
FROM messaging."MessageCommands"
WHERE status = 'unknown' AND "errorCode" = 'DELIVERY_UNCONFIRMED'
GROUP BY "whatsappId" ORDER BY pendentes DESC;

-- Saúde de entrega por canal (T5):
SELECT id, "deliveryHealth", "consecutiveUnconfirmedDeliveries",
       "lastDeliveryErrorCode", "lastUnconfirmedDeliveryAt", "lastConfirmedDeliveryAt"
FROM "Whatsapps"
WHERE "companyId" = :companyId;

-- Leases de sessão vigentes (quem é dono de cada canal, fencing):
SELECT "whatsappId", "ownerId", "fencingToken", "expiresAt"
FROM messaging."WhatsAppSessionLeases"
ORDER BY "whatsappId";

-- Revisões de credencial/chaves por canal (T6; NUNCA selecionar ciphertext):
SELECT "whatsappId", "keyType", COUNT(*) AS chaves, MAX(revision) AS ultima_revisao
FROM messaging."WhatsAppSessionKeys"
GROUP BY "whatsappId", "keyType"
ORDER BY "whatsappId", "keyType";
```

## Referências

- Política de desconexão: `src/services/WbotServices/BaileysDisconnectPolicy.ts`.
- Saúde de entrega do canal: `src/messaging/application/ChannelDeliveryHealthService.ts`.
- Telemetria/alertas: `src/messaging/telemetry/DeliveryObservability.ts`.
- Rollout do storage de chaves (T6): `npm run backfill:whatsapp-session-keys`
  (dry-run por padrão; contagens apenas, sem payload).

## Desempenho e limites operacionais de envio (T8)

- **Lanes por canal**: o dispatcher despacha até `MESSAGING_DISPATCH_CHANNEL_CONCURRENCY` canais em paralelo por rodada (padrão 8, máximo 64). Cada canal é uma lane serial — o comando mais antigo da fila do canal é reivindicado primeiro e o próximo só entra após o anterior finalizar, garantindo a ordem de envio por canal. Um canal lento ou desconectado ocupa apenas a própria lane: socket indisponível agenda retry em 30s sem tocar nos demais canais.
- **Cache de retry limitado**: `msgRetryCounterCache` tem TTL de 10 minutos e máximo de 1000 chaves (evicção do mais antigo). O cache é criado por socket — substituir a geração descarta o cache inteiro junto com ele.
- **Latências do pipeline** (endpoint de métricas, chave `deliverySignals.sendPipeline`): `send_pipeline_commit_to_dispatch_ms` (commit do outbox → claim), `send_pipeline_dispatch_to_provider_id_ms` (send → providerMessageId persistido) e `send_pipeline_provider_id_to_ack_ms` (SENT → ACK que avança o comando). Reservatório de 512 amostras por estágio; o snapshot expõe p50/p95/p99/max. Compare com o baseline do ambiente aprovado antes/depois de mudanças no pipeline — sem teste de carga em produção.
