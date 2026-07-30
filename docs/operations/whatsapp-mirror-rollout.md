# Rollout do espelho WhatsApp

## Estado inicial seguro

`MESSAGING_WEBHOOK_MIRROR_V1_ENABLED` e
`MESSAGING_WEBHOOK_REPLAY_ENABLED` ficam desabilitadas por padrão. O endpoint
de replay responde `404` salvo quando o processo está em `NODE_ENV=staging` e
as duas flags estão explicitamente em `true`.

O replay persiste eventos sintéticos de provider no PostgreSQL. Ele não abre
sessões, não chama APIs de envio Baileys/Meta e não cria 270.000 mensagens
WhatsApp. O runtime existente faz projeção, snapshot AES, fanout, assinatura
HMAC e entrega HTTPS.

Cada request materializa um source event ID e timestamp determinísticos por
`runId + sequence`, sem alterar os adapters usados em produção. Assim, uma
sequência nova gera um aggregate novo e o retry da mesma sequência é
deduplicado. O ciclo achata as duas fixtures antes da seleção e percorre os 32
inputs (2 x 16) antes de repetir; cada request publica exatamente um evento no
outbox.

## Pré-requisitos obrigatórios

1. Staging separado de produção, com PostgreSQL real, migrations atuais e
   chaves de criptografia exclusivas de staging.
2. Subscription exclusiva apontando para um receiver n8n de staging, com os
   eventos das fixtures habilitados. Não reutilize uma subscription de
   produção.
3. O receiver valida `X-DiaChat-Timestamp` e
   `X-DiaChat-Signature=sha256(HMAC(secret, timestamp + "." + raw_body))`,
   deduplica por `X-DiaChat-Delivery` e nunca registra raw body, telefone, JID,
   texto, URL ou segredo em logs/labels.
4. O n8n desabilita salvamento de execuções bem-sucedidas e payloads completos.
   Seu endpoint autenticado de status retorna somente:

```json
{
  "received": 270000,
  "expectedDuplicates": 0,
  "unexpectedDuplicates": 0,
  "signatureFailures": 0,
  "plaintextViolations": 0
}
```

`plaintextViolations` conta qualquer persistência/log do raw body fora da
memória necessária para validar HMAC. O body trafega apenas por HTTPS e deve
permanecer cifrado no banco do DIA CHAT.

## Validação sem carga

No diretório `app/backend`, execute:

```powershell
npm.cmd run capacity:whatsapp-mirror
npm.cmd run verify:roteador-contract
```

### Gate externo atualmente bloqueado

O verificador gera os envelopes em runtime pelos adapters Baileys/Meta e pelo
`WhatsAppMirrorProjectionService`; ele não usa envelopes manuais. No parser
atual do Roteador, o resultado deste checkout é falha: o campo top-level
`schema` é rejeitado por `extra=forbid` e os tipos especializados
`message.reaction`, `message.edited`, `message.deleted`, `chat.updated` e
`connection.updated` não pertencem ao literal aceito.

Logo, `verify:roteador-contract` termina com exit code diferente de zero e a
ativação live permanece bloqueada. O runner live executa esse preflight antes
de injetar qualquer evento. Não habilite o espelho até que o contrato externo
seja coordenado e o mesmo verificador termine com exit code zero.

O primeiro comando apenas valida fixtures/configuração e grava
`artifacts/capacity/whatsapp-mirror-dry-validation-*.json`. O segundo importa o
parser atual do checkout Roteador indicado por `ROTEADOR_ROOT` ou usa o
repositório irmão e sua `.venv`; nenhum arquivo do Roteador é alterado.

## Ativação somente em staging

Configure o backend de staging:

```text
NODE_ENV=staging
MESSAGING_WEBHOOK_MIRROR_V1_ENABLED=true
MESSAGING_WEBHOOK_REPLAY_ENABLED=true
MESSAGING_WEBHOOK_FANOUT_CONCURRENCY=8
MESSAGING_WEBHOOK_DELIVERY_CONCURRENCY=64
```

Na máquina isolada do gate, configure os valores de
`docs/operations/whatsapp-mirror-capacity.example` em um secret store e rode:

```powershell
npm.cmd run capacity:whatsapp-mirror
```

O gate é fixo: 150 eventos/s por 1.800 s, total de 270.000 eventos, com
deadline de drain de 900 s. Ele falha se houver perda, duplicata inesperada,
falha HMAC, plaintext at rest/logado ou drain acima de 15 minutos. Tokens,
URLs internas, bodies e PII não entram no relatório.

O scheduler oferece exatamente 150 eventos em cada uma das 1.800 janelas,
independentemente do tempo de conclusão das requests. O relatório separa
`offeredEvents`, `offeredRps`, `injectionElapsedSeconds` e
`completionElapsedSeconds`; a tolerância explícita do relógio é 0,5% e não
permite aprovar uma oferta incompleta. Requests de injeção e polls usam
`AbortController` com timeout para que um endpoint travado não suspenda o gate
indefinidamente. Cada request leva o mesmo `runStartedAt`, e seu timestamp
sintético é derivado da sequência a 150/s sem ultrapassar o instante aceito.

Enquanto houver backlog, o runtime executa até oito rodadas imediatas por pool
antes de devolver controle ao intervalo principal; lanes continuam isoladas e
uma falha não interrompe as demais.

Falhas de projeção/crypto incrementam `MessagingOutboxEvent.attemptCount`
duravelmente no claim. O evento retorna com backoff de 5, 15, 30, 60 e 120 s e
vai para `dead_letter` na sexta tentativa, preservando o código `lastError`.
Todos os updates usam `leaseToken` como fence.

## Monitoramento e promoção

Monitore `GET /internal/v1/messaging/metrics` com credencial de serviço:

- `mirror.durableFailures.projection` e
  `mirror.durableFailures.crypto`, derivados do PostgreSQL;
- `mirror.projectionFailures`, `mirror.cryptoFailures`;
- `outbox.ready`, `outbox.inFlight`, `outbox.oldestPendingSeconds`;
- `webhooks.ready`, `webhooks.inFlight`, `webhooks.oldestPendingSeconds`;
- `mirror.throughput`, `mirror.purge` e `mirror.media`;
- dead letters de commands, inbox, outbox e webhooks;
- pool PostgreSQL, RSS e receiver n8n.

Não promova com contador de falha crescente, dead letter nova, backlog que não
drena, assinatura inválida, perda, duplicata inesperada ou plaintext.

## Rollback sem downgrade

1. Defina `MESSAGING_WEBHOOK_REPLAY_ENABLED=false` para interromper novas
   injeções sintéticas.
2. Aguarde o backlog já persistido drenar ou pause somente a subscription de
   staging.
3. Para voltar ao contrato legado, defina
   `MESSAGING_WEBHOOK_MIRROR_V1_ENABLED=false`.
4. Não reverta migrations e não apague outbox/deliveries. O rollback é apenas
   por flags; preserve dados para recovery e auditoria.

## Estado deste checkout

A ativação está bloqueada pela incompatibilidade confirmada do parser externo.
Os contadores locais de projection/crypto são apenas telemetria auxiliar; o
release gate usa os agregados duráveis do PostgreSQL.

A validação local/dry e o contrato das fixtures são executáveis. O gate real
permanece externo: não há PostgreSQL local nem target/receiver n8n de staging
configurado neste checkout. Produção não deve ser usada como substituto.
