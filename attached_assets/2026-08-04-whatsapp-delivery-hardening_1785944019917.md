# WhatsApp Delivery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar a criação concorrente de sockets por canal, impedir corrupção concorrente das credenciais, unificar todo envio no outbox e tornar a degradação silenciosa de entrega visível e operável sem reenvio automático.

**Architecture:** Um SessionManager single-flight será o único proprietário local do socket Baileys de cada canal; uma lease PostgreSQL com fencing token garantirá a mesma exclusividade entre processos e réplicas. UI, API interna, API pública e automações persistirão Message + MessageCommand + evento de outbox na mesma transação; o dispatcher será o único caminho de envio. A persistência de autenticação será serializada imediatamente e depois migrada do JSON monolítico para registros criptografados por chave no PostgreSQL.

**Tech Stack:** Node.js 20, TypeScript, Express, Baileys 6.7.24 vendorizado, Sequelize, PostgreSQL 16, Redis, Bull, Socket.IO, Jest e React.

## Global Constraints

- Partir do commit remoto ff00aa352912405e3968fce9ac36027467c27f5d ou de um descendente já validado; o checkout local em que este documento foi criado estava 32 commits atrás (verificado com `git rev-list --count HEAD..ff00aa35...` = 32).
- Manter Baileys 6.7.24 nesta entrega. A avaliação de Baileys 7 deve permanecer isolada. `app/backend/package.json` aponta `baileys` para `file:vendor/baileys-6.7.24.tgz` (verificado).
- Ausência de ACK gera alerta e estado degradado; não reinicia sessão, não bloqueia o canal e não reenvia mensagem automaticamente.
- Reconexão automática continua permitida apenas para falhas explícitas e transitórias de transporte, sempre sob single-flight e backoff.
- Nunca reenviar um comando quando o resultado do envio for ambíguo. Marcar como unknown exige decisão humana ou ACK tardio.
- Nunca registrar corpo de mensagem, telefone completo, JID completo, QR, credenciais, chaves Signal ou payload descriptografado.
- Preservar PN, LID e JID como identidades distintas. Não converter LID em número de telefone.
- PostgreSQL é a fonte de verdade. Redis pode ser cache, nunca armazenamento definitivo de credencial.
- Cada tarefa segue RED, confirmação da falha, implementação mínima GREEN, refatoração e verificação focada.
- Migrações devem ter teste de apply, rollback e reapply em PostgreSQL 16, seguindo o padrão existente em `src/database/migrations/__tests__/` com tabelas no schema `messaging`.
- Não executar carga em produção. Homologação usa canal e destinatário controlados.

---

## 1. Resumo executivo

O incidente não foi uma indisponibilidade total. A sessão do canal testemvp continuava autenticada o suficiente para abrir conexão e receber mensagens, mas os envios permaneciam com ack=0 indefinidamente. Um novo pareamento restaurou confirmações ack=3 e ack=4 em segundos.

A explicação operacional mais consistente é uma sessão degradada no lado do WhatsApp. O provável gatilho foi a abertura concorrente de várias conexões para a mesma identidade durante o boot e por cliques repetidos em conectar. Essa causalidade é uma hipótese forte, não uma prova emitida pelo WhatsApp.

### 1.1 Estado atual verificado no código (rev. 2)

As condições abaixo foram confirmadas por inspeção direta do código na revisão deste plano:

- `app/backend/src/libs/wbot.ts` mantém `sessions: Session[]` (linha 37) e `getWbot` retorna apenas a primeira sessão localizada pelo whatsappId; sockets duplicados permanecem conectados em segundo plano;
- não existe trava para chamadas concorrentes de `StartWhatsAppSession`; boot (`StartAllWhatsAppsSessions`), endpoint conectar (`WhatsAppSessionController.store/update`) e callbacks de `connection=close` disparam `initWASocket` livremente;
- a reconexão usa `setTimeout(..., 2000)` solto dentro do callback de `wbot.ts` (linhas 205-208 e 220-223), fora de qualquer gerenciador, e callbacks de sockets antigos podem alterar banco, credenciais e status;
- `authState` (`src/helpers/authState.ts`) mantém uma cópia mutável completa de creds + keys por socket; `keys.set` (linha 62-70) dispara `saveState()` sem `await`; diferentes sockets podem sobrescrever todo o JSON (last-write-wins); falhas de escrita caem em `console.log` silencioso (linhas 29-31);
- `retriesQrCodeMap` é um Map module-level em `wbot.ts` (linha 44), compartilhado entre gerações de socket;
- `connection=open` significa transporte autenticado, não comprovação de entrega;
- cada socket registra listeners em pelo menos quatro origens distintas: callback inline de `wbot.ts` (`connection.update`, `creds.update`), `registerBaileysConnectionLifecycle` (listeners do mirror), `wbotMessageListener` (arquivo de 3.003 linhas, com `messages.upsert` e `messages.update` na linha 2985) e `wbotMonitor` (`CB:call` etc.);
- existem **dois escritores de ACK** hoje: o legado `handleMsgAck` (`wbotMessageListener.ts` linha 2873, chamado na linha 2990, que também executa `readMessages` em todo update) e o novo `BaileysProviderEventAdapter` (linha 462) → `messaging/public/domainEvents.ts` → `BaileysDomainEventService.acknowledgeProviderMessage`;
- `acknowledgeProviderMessage` atualiza `Message.ack` e publica `message.status.updated`, mas **nada transiciona `MessageCommand.status` para `delivered`/`read`** — esses valores só aparecem como constantes terminais em `OutboundPairRecoveryService`;
- a tela (`MessageController`), o endpoint interno `/api/messages/send` (`InternalV1Controller`, linhas 369-370), as automações de webhook (`ActionsWebhookService`) e mensagens de sistema (`wbotClosedTickets`, `UpdateTicketService`, resposta a chamadas em `wbotMonitor`) ainda enviam diretamente pelo socket, fora do MessageCommand;
- o envio direto atual de texto (`SendWhatsAppMessage`) já passa pela fachada `BaileysTicketMessagingProvider` com espera de reconexão de 45 s (`GetTicketWbot(ticket, { waitForReconnectMs: 45000 })`) e mapeamento 503; a Message local desses envios nasce hoje do eco `messages.upsert` (fromMe) do próprio socket, não de uma gravação upfront;
- o frontend já envia `clientMessageId` para texto (`MessageInput/index.js` linhas 188-201: `randomUUID` por tentativa, preservado entre retries do mesmo corpo) e o backend já deduplica via `V1MessageIdempotency`; mídia não tem idempotência alguma (`Promise.all` de envios diretos, resposta 200 vazia);
- `PublicTextMessageService` já implementa o padrão alvo para a API pública: Message + MessageCommand + MessagingOutboxEvent na mesma transação, fingerprint, `409 IDEMPOTENCY_CONFLICT` e `replayed`; `MessageCommandService` já oferece `CreateMessageCommandInput`, `fingerprint()` e `create()` idempotente.

### 1.2 O que existe e o que NÃO existe de recovery hoje

Existe `OutboundPairRecoveryService` (registrado como `RecoveryRunner` em `MessagingRuntime`), que cobre somente: comando `sending` com lease expirado vira `unknown` + `SEND_OUTCOME_UNKNOWN`; evento `processing` órfão é reaberto ou concluído; o leaseToken é sempre limpo (fencing de finalização).

**Não existe hoje** (contrariando versões anteriores deste plano):

- watchdog para comando `sent` que ficou sem ACK — nada marca `unknown` por ausência de ACK após qualquer prazo;
- o código de erro `DELIVERY_UNCONFIRMED` (ausente em todo o código; `MESSAGE_COMMAND_ERROR_CODE` só tem `SEND_OUTCOME_UNKNOWN` e `SEND_RETRY_EXHAUSTED`);
- reconciliação de `unknown` por ACK tardio;
- transição de `MessageCommand` por ACK (sent → delivered → read);
- qualquer noção de `deliveryHealth` do canal.

Portanto a Task 5 é **construção de funcionalidade nova** (watchdog de ACK-timeout, novo error code, reconciliação, transições de comando, saúde do canal), e não exposição de comportamento já existente. O plano abaixo fecha as causas estruturais e adiciona essa capacidade para operador e observabilidade.

## 2. Resultado esperado

Depois da implementação:

1. Existe no máximo um socket ativo e uma tentativa de conexão em andamento por whatsappId no processo e no conjunto de réplicas.
2. Somente o fencing token vigente pode atualizar credenciais, status, QR, listeners ou agendar reconexão.
3. Toda origem de mensagem (UI, `/api/messages/send`, `/api/v1/messages`, automações de webhook) usa a mesma transação de comando e o mesmo dispatcher.
4. O HTTP confirma aceitação durável, não entrega pelo WhatsApp.
5. O eco `messages.upsert` fromMe nunca duplica uma Message criada upfront pelo comando.
6. Existe uma única autoridade de ACK; ACK 0/1 por cinco minutos aparece como entrega não confirmada na conversa.
7. Duas falhas consecutivas em dez minutos marcam deliveryHealth=degraded e disparam alerta, sem ação destrutiva automática.
8. ACK >= 2 restaura deliveryHealth=healthy e corrige mensagem/comando mesmo quando chega atrasado; `MessageCommand` acompanha sent → delivered → read.
9. Credenciais deixam de sofrer last-write-wins e, na segunda etapa, são persistidas por chave criptografada.

## 3. Estados e contratos

### 3.1 Estados do canal

Separar conectividade de capacidade comprovada de envio:

    transportState = disconnected | opening | qr | connected | reconnecting | terminal
    deliveryHealth = unknown | healthy | degraded

Regras:

- novo socket aberto: transportState=connected e deliveryHealth=unknown;
- primeiro ACK >= 2 da geração atual: deliveryHealth=healthy;
- um DELIVERY_UNCONFIRMED: manter unknown se ainda não houve confirmação saudável;
- dois DELIVERY_UNCONFIRMED consecutivos no intervalo móvel de dez minutos: deliveryHealth=degraded;
- qualquer ACK >= 2 posterior: deliveryHealth=healthy, consecutiveUnconfirmed=0;
- connection=open nunca define deliveryHealth=healthy.

Adicionar à tabela Whatsapps:

    deliveryHealth VARCHAR(16) NOT NULL DEFAULT 'unknown'
    deliveryHealthChangedAt TIMESTAMPTZ NULL
    lastConfirmedDeliveryAt TIMESTAMPTZ NULL
    consecutiveUnconfirmed INTEGER NOT NULL DEFAULT 0
    lastDeliveryErrorCode VARCHAR(64) NULL

O campo status legado continua preenchido durante a compatibilidade. O backend deve derivar transportState de forma centralizada e parar de espalhar strings de estado em callbacks.

### 3.2 Estado da mensagem

O contrato aditivo retornado por GET /messages/:ticketId e pelo evento Socket.IO company-{companyId}-appMessage é:

    {
      "delivery": {
        "status": "queued|sending|sent|delivered|read|failed|unknown|cancelled",
        "errorCode": "DELIVERY_UNCONFIRMED|null",
        "updatedAt": "ISO-8601"
      }
    }

Semântica (alinhada a `MESSAGE_COMMAND_STATUS` e `MESSAGE_COMMAND_ERROR_CODE` de `messaging/domain/MessagingStates.ts`, que receberá o novo código `DELIVERY_UNCONFIRMED`):

- queued: aceito e persistido;
- sending: lease ativa no dispatcher;
- sent: Baileys retornou providerMessageId e ainda não há confirmação superior;
- delivered: ack >= 3;
- read: ack >= 4;
- unknown: resultado ambíguo (SEND_OUTCOME_UNKNOWN) ou falta de ACK no prazo (DELIVERY_UNCONFIRMED);
- failed: falha definitiva conhecida antes da aceitação pelo provedor;
- cancelled: cancelamento explícito permitido pelo domínio.

ACK 2 mantém status sent porque comprova aceite pelo servidor do WhatsApp. O texto da interface deve diferenciar sent de delivered.

### 3.3 Resposta do envio interno

POST /messages/:ticketId passa a responder 202:

    {
      "commandId": "uuid",
      "messageId": "local-stable-message-id",
      "status": "queued",
      "replayed": false
    }

Para repetição da mesma chave e mesmo fingerprint, retornar o snapshot original e replayed=true. Mesma chave com payload diferente retorna 409 IDEMPOTENCY_CONFLICT.

Texto exige clientMessageId (o frontend já o envia hoje; o backend passa a usá-lo como idempotencyKey do MessageCommand). Lote de mídia exige clientBatchId; cada item usa a chave determinística clientBatchId:{index}. quotedMessageId entra no requestPayload, sem serializar o modelo inteiro — substituindo a leitura atual de `Message.dataJson` em `SendWhatsAppMessage`.

A resposta de mídia, hoje 200 vazio após `Promise.all` de envios diretos, passa a ser 202 com a lista de comandos do lote.

O contrato público POST /api/v1/messages mantém compatibilidade de campos e status HTTP já documentados. Ele deve apenas compartilhar o mesmo serviço de criação de comando.

### 3.4 Evento de conexão

O evento Socket.IO de sessão recebe campos aditivos:

    {
      "transportState": "connected",
      "deliveryHealth": "unknown",
      "reasonCode": null,
      "activeSocketCount": 1,
      "generation": 42
    }

activeSocketCount é métrica diagnóstica do processo. Em operação normal deve ser zero ou um para o canal.

## 4. Arquitetura alvo

    origem UI/API interna/API pública/automação
              |
              v
    CreateMessageCommandService (núcleo extraído de PublicTextMessageService,
      reutilizando MessageCommandService/fingerprint existentes)
      Message + MessageCommand + OutboxEvent
              | mesma transação
              v
    MessageCommandDispatcher
              |
              v
    BaileysMessageCommandProvider
              |
              v
    WhatsAppSessionManager -> um socket da geração atual
              |
         ACK/lifecycle (autoridade única)
              v
    BaileysDomainEventService
      comando + mensagem + deliveryHealth + eventos

O SessionManager é dono exclusivo de start, replace, getReady e stop. Controller, boot, monitor e callbacks não chamam initWASocket diretamente. Antes de abrir o socket, o manager precisa adquirir uma lease PostgreSQL do canal. A lease tem ownerId do processo, fencingToken monotônico, expiresAt e heartbeatAt. O heartbeat sugerido é de 10 segundos e o TTL de 30 segundos; perder a renovação fecha o socket imediatamente.

Interface proposta:

    interface ManagedSession {
      whatsappId: number;
      companyId: number;
      generation: number; // mesmo valor do fencingToken persistido
      socket: WASocket;
      openedAt?: Date;
      closing: boolean;
    }

    interface WhatsAppSessionManager {
      start(input: StartSessionInput): Promise<ManagedSession>;
      replace(input: StartSessionInput, reason: SessionStartReason): Promise<ManagedSession>;
      getReady(whatsappId: number, timeoutMs?: number): Promise<ManagedSession>;
      stop(whatsappId: number, mode: "close" | "logout"): Promise<void>;
      isCurrent(whatsappId: number, generation: number): boolean;
      diagnostics(whatsappId: number): SessionDiagnostics;
    }

Estruturas mínimas:

    activeSessions: Map<number, ManagedSession>
    inFlightConnections: Map<number, Promise<ManagedSession>>
    generations: Map<number, number>
    reconnectTimers: Map<number, NodeJS.Timeout>
    qrRetryCounters: Map<number, number>   // absorve o retriesQrCodeMap hoje solto em wbot.ts

start devolve a mesma Promise quando já existe uma tentativa. replace cancela timer, adquire o próximo fencingToken, remove listeners, fecha o socket anterior e somente então cria o próximo. Todo callback captura whatsappId + generation e começa validando isCurrent. Escritas persistentes de lifecycle e autenticação usam operação condicional contra a lease, impedindo que um processo pausado volte e grave com token vencido.

Mapeamento dos entrypoints atuais para o manager:

- `StartAllWhatsAppsSessions` (boot) → start, apenas para canais com credenciais JSON válidas contendo `creds.me`;
- `WhatsAppSessionController.store` (conectar) → start (single-flight absorve cliques repetidos);
- `WhatsAppSessionController.update` (zera session e reinicia) → replace;
- `WhatsAppSessionController.remove` (hoje `getWbot().logout()` direto) → stop(whatsappId, "logout");
- callback `connection=close` → BaileysDisconnectPolicy → stop("close") ou replace com backoff;
- `SendWhatsAppMessage`/`SendWhatsAppMedia` (enquanto existirem) e o dispatcher → getReady(whatsappId, timeoutMs), preservando a semântica atual de espera de reconexão de 45 s e mapeamento 503 (`ERR_WAPP_NOT_AVAILABLE`).

Registro de listeners: todos os `ev.on`/`ws.on` por socket (callback de conexão, creds.update, mirror lifecycle, wbotMessageListener, wbotMonitor) passam a ser registrados pelo manager no momento da criação da ManagedSession, capturando a geração, e removidos no replace/stop. O inventário completo dos pontos de registro é passo explícito da Task 2.

## 5. Política de desconexão

Centralizar a classificação em BaileysDisconnectPolicy:

| Classe | Exemplos | Ação |
|---|---|---|
| terminal | loggedOut/401, forbidden/403, connectionReplaced/440, badSession | encerrar, limpar somente o que a política exigir, marcar terminal e pedir intervenção |
| transitória | connectionClosed/428, timedOut/408, restartRequired/515 | reconectar single-flight com backoff exponencial e jitter |
| rejeição/cooldown | 463 ou reach-out timelock | encerrar loop, alertar e exigir avaliação/repareamento |
| desconhecida | código ausente ou novo | uma tentativa controlada; ao repetir, terminal operacional e alerta |

A política deve decidir explicitamente, por classe, o destino dos artefatos hoje manipulados nos branches soltos de `wbot.ts`: `Whatsapp.session` (zerar ou preservar), `DeleteBaileysService` (cache contacts/chats do modelo `Baileys`) e o evento Socket.IO de sessão. Em particular: 440 (connectionReplaced) não reconecta e **não** apaga credencial como se fosse logout; 401/403/badSession seguem a política terminal explícita.

Nenhum callback usa setTimeout solto. O SessionManager mantém um timer por canal. Limites sugeridos: base 2 s, máximo 2 min, jitter de 0,5 a 1,5, reset após conexão estável.

## 6. Plano de implementação

### Task 0: Sincronizar baseline e restaurar o gate do repositório

**Files:**

- Modify: app/frontend/package-lock.json
- Modify: app/frontend/yarn.lock
- Verify: scripts/checkPortableLockfiles.js
- Verify: scripts/checkPortableLockfiles.test.js

- [ ] Criar branch codex/whatsapp-delivery-hardening a partir de ff00aa352912405e3968fce9ac36027467c27f5d ou descendente.
- [ ] Executar node scripts/checkPortableLockfiles.js e registrar o erro atual. (Estado verificado na revisão: exit 1, `NON_PORTABLE_LOCKFILE_REGISTRY`, 10 violações com host `package-firewall.replit.local` — 5 em app/frontend/package-lock.json e 5 em app/frontend/yarn.lock; o lockfile do backend está limpo.)
- [ ] Corrigir somente as referências portáveis quebradas e regenerar os lockfiles do frontend com a versão de Node/npm/yarn declarada pelo projeto.
- [ ] Executar novamente o gate até exit code 0.
- [ ] Confirmar que app/backend/package.json ainda aponta baileys para file:vendor/baileys-6.7.24.tgz.
- [ ] Commit: chore(ci): restore portable lockfile baseline.

O desenvolvimento funcional não começa sobre uma baseline cuja CI falha antes dos testes.

### Task 1: Introduzir SessionManager single-flight

**Files:**

- Create: app/backend/src/services/WbotServices/WhatsAppSessionManager.ts
- Create: app/backend/src/services/WbotServices/BaileysDisconnectPolicy.ts
- Create: app/backend/src/database/migrations/20260804000000-create-whatsapp-session-leases.ts
- Create: app/backend/src/database/migrations/__tests__/20260804000000-create-whatsapp-session-leases.spec.ts
- Create: app/backend/src/messaging/persistence/models/WhatsAppSessionLease.ts
- Create: app/backend/src/messaging/persistence/WhatsAppSessionLeaseRepository.ts
- Create: app/backend/src/services/WbotServices/__tests__/WhatsAppSessionManager.spec.ts
- Create: app/backend/src/services/WbotServices/__tests__/BaileysDisconnectPolicy.spec.ts
- Modify: app/backend/src/libs/wbot.ts
- Modify: app/backend/src/libs/waitForSessionReady.ts
- Modify: app/backend/src/database/index.ts

- [ ] RED: duas chamadas start simultâneas para o mesmo whatsappId executam a factory uma vez e recebem a mesma sessão.
- [ ] RED: dois managers com ownerId diferentes disputam o mesmo whatsappId e somente o detentor da lease abre socket.
- [ ] RED: takeover após expiresAt incrementa fencingToken; o proprietário antigo perde a renovação e fecha seu socket.
- [ ] RED: lease indisponível (PostgreSQL inacessível ou erro na aquisição) falha fechado — nenhum socket abre sem lease vigente.
- [ ] RED: replace fecha e remove listeners da sessão anterior antes de publicar a nova.
- [ ] RED: callback de geração antiga não altera Whatsapp, QR ou timers.
- [ ] RED: dez cliques concorrentes em conectar deixam activeSocketCount=1.
- [ ] RED: stop close não faz logout; stop logout encerra e invalida credenciais conforme política explícita.
- [ ] Criar messaging.WhatsAppSessionLeases com whatsappId como PK, ownerId UUID, fencingToken BIGINT, expiresAt e heartbeatAt; aquisição e renovação devem ser transacionais; definir o destino da row no stop (release explícito vs. expirar) e cobri-lo com teste.
- [ ] Implementar os Maps locais (incluindo qrRetryCounters, absorvendo o retriesQrCodeMap de wbot.ts) e usar o fencingToken da lease como generation, sem singleton global adicional fora do manager exportado.
- [ ] Fechar o socket se duas renovações consecutivas falharem ou se a lease já pertencer a outro ownerId; não esperar o TTL terminar.
- [ ] Fazer getWbot, waitForWbot e removeWbot delegarem ao manager; remover o array sessions após migrar todos os callers.
- [ ] Expor uma socketFactory injetável para testes, sem mockar módulos internos inteiros.
- [ ] Executar:

    cd app/backend
    npx jest --runInBand src/services/WbotServices/__tests__/WhatsAppSessionManager.spec.ts src/services/WbotServices/__tests__/BaileysDisconnectPolicy.spec.ts

- [ ] Commit: feat(whatsapp): enforce one managed socket per channel.

### Task 2: Migrar boot, controller, listeners e reconexão para o manager

**Files:**

- Modify: app/backend/src/services/WbotServices/StartWhatsAppSession.ts
- Modify: app/backend/src/services/WbotServices/StartAllWhatsAppsSessions.ts
- Modify: app/backend/src/services/WbotServices/BaileysConnectionLifecycle.ts
- Modify: app/backend/src/services/WbotServices/wbotMessageListener.ts
- Modify: app/backend/src/services/WbotServices/wbotMonitor.ts
- Modify: app/backend/src/controllers/WhatsAppSessionController.ts
- Modify: app/backend/src/libs/wbot.ts
- Modify: app/backend/src/services/WbotServices/__tests__/BaileysConnectionLifecycle.spec.ts
- Create: app/backend/src/services/WbotServices/__tests__/StartAllWhatsAppsSessionsConcurrency.spec.ts

- [ ] Inventariar TODOS os pontos de registro de listeners por socket e registrá-los via manager com geração capturada: callback inline de wbot.ts (`connection.update`), `creds.update`, `registerBaileysConnectionLifecycle`/mirror, `wbotMessageListener` (`messages.upsert`, `messages.update` e demais) e `wbotMonitor` (`CB:call` etc.). Registrar esse inventário no código ou em comentário do manager.
- [ ] RED: boot, endpoint conectar e callback close concorrentes criam apenas uma tentativa.
- [ ] RED: somente credenciais JSON válidas com creds.me iniciam no boot.
- [ ] RED: 440 não reconecta e não apaga credencial como se fosse logout.
- [ ] RED: 408, 428 e 515 reconectam uma vez com backoff controlado.
- [ ] RED: 401/403/badSession encerram a sessão e produzem reasonCode estável, com destino explícito para Whatsapp.session e DeleteBaileysService definido pela política.
- [ ] RED: listeners de uma geração substituída não processam mensagens nem ACKs após o replace.
- [ ] Mapear os endpoints do controller: store → start; update → replace; remove → stop("logout"), sem chamadas diretas a getWbot().logout().
- [ ] Remover chamadas diretas a initWASocket e timers de reconexão fora do manager; remover retriesQrCodeMap de wbot.ts.
- [ ] Atualizar status e emitir Socket.IO somente depois de validar a geração.
- [ ] Registrar wbotMessageListener e wbotMonitor uma única vez por ManagedSession.
- [ ] Garantir que connection=open publica connected + deliveryHealth atual, sem declarar entrega saudável.
- [ ] Executar as duas suítes acima e BaileysConnectionLifecycle.spec.ts.
- [ ] Commit: refactor(whatsapp): centralize lifecycle, listeners and reconnect policy.

### Task 3: Serializar a persistência atual de autenticação

**Files:**

- Create: app/backend/src/services/WbotServices/WhatsAppAuthStateWriter.ts
- Create: app/backend/src/services/WbotServices/__tests__/WhatsAppAuthStateWriter.spec.ts
- Modify: app/backend/src/helpers/authState.ts
- Modify: app/backend/src/libs/wbot.ts

- [ ] RED: duas mutações keys.set concorrentes são persistidas em ordem, sem perder chaves.
- [ ] RED: save de geração antiga é rejeitado e não sobrescreve sessão da geração atual.
- [ ] RED: falha de banco rejeita a escrita, produz log estruturado e não vira console.log silencioso (hoje linhas 29-31 de authState.ts).
- [ ] RED: creds.update e keys.set aguardam a fila de escrita correspondente ao whatsappId.
- [ ] Implementar fila Promise por canal, revisão monotônica e snapshot obtido somente dentro da fila.
- [ ] Passar generation do manager ao authState e validar fence antes de Whatsapp.update.
- [ ] Manter BufferJSON.replacer/reviver e o formato JSON atual nesta etapa.
- [ ] Fechar e sinalizar a sessão quando uma escrita obrigatória de credencial falhar repetidamente; não apagar o último snapshot válido.
- [ ] Executar:

    cd app/backend
    npx jest --runInBand src/services/WbotServices/__tests__/WhatsAppAuthStateWriter.spec.ts

- [ ] Commit: fix(whatsapp): serialize and fence auth state writes.

### Task 4: Unificar UI, API interna, API pública e automações no outbox

**Files:**

- Create: app/backend/src/messaging/application/CreateMessageCommandService.ts
- Create: app/backend/src/messaging/application/__tests__/CreateMessageCommandService.spec.ts
- Modify: app/backend/src/messaging/application/MessageCommandService.ts
- Modify: app/backend/src/messaging/application/PublicTextMessageService.ts
- Modify: app/backend/src/controllers/MessageController.ts
- Modify: app/backend/src/controllers/InternalV1Controller.ts
- Modify: app/backend/src/services/WebhookService/ActionsWebhookService.ts
- Modify: app/backend/src/routes/messageRoutes.ts
- Modify: app/backend/src/messaging/adapters/baileys/BaileysMessageCommandProvider.ts
- Modify: app/backend/src/messaging/outbox/MessageCommandDispatcher.ts
- Modify: app/backend/src/models/V1MessageIdempotency.ts
- Modify: app/frontend/src/components/MessageInput/index.js
- Modify: app/backend/src/controllers/__tests__/MessageControllerIdempotency.spec.ts
- Modify: app/backend/src/messaging/application/__tests__/PublicTextMessageService.spec.ts
- Modify: app/backend/src/messaging/outbox/__tests__/MessageCommandDispatcher.spec.ts

- [ ] Extrair de PublicTextMessageService o núcleo genérico CreateMessageCommandService, reutilizando MessageCommandService/fingerprint existentes como autoridade única de criação idempotente — não criar uma segunda implementação paralela de fingerprint ou deduplicação; migrar os callers atuais de MessageCommandService se a extração o tornar redundante.
- [ ] RED: POST /messages/:ticketId não chama SendWhatsAppMessage nem SendWhatsAppMedia diretamente.
- [ ] RED: /api/messages/send (InternalV1Controller) e ActionsWebhookService não chamam SendWhatsAppMessage/SendWhatsAppMedia diretamente.
- [ ] RED: texto cria Message, MessageCommand e MessagingOutboxEvent na mesma transação.
- [ ] RED: falha antes do commit não deixa mensagem fantasma; falha depois do 202 é processada pelo dispatcher.
- [ ] RED: retry com mesma chave/fingerprint retorna o snapshot sem novo comando.
- [ ] RED: mesma chave com conteúdo diferente retorna 409 IDEMPOTENCY_CONFLICT.
- [ ] RED: lote de três mídias cria três comandos com clientBatchId:0, :1 e :2.
- [ ] RED: quotedMessageId inválido retorna 400; válido é convertido na referência Baileys no provider (substituindo a leitura de Message.dataJson).
- [ ] RED: timeout após socket.sendMessage retorna unknown quando não é possível provar que o provedor rejeitou.
- [ ] RED: o eco messages.upsert fromMe de um providerMessageId já persistido pelo comando ATUALIZA a Message criada upfront em vez de criar duplicata (correlação por providerMessageId/messageId).
- [ ] Mover upload aceito para armazenamento durável antes de enfileirar; requestPayload guarda apenas caminho controlado em messaging/.
- [ ] Responder 202 após commit, sem esperar rede; lote de mídia responde 202 com a lista de comandos (hoje é 200 vazio).
- [ ] Remover Promise.all de envios diretos de mídia; preservar ordenação do lote.
- [ ] Preservar no caminho unificado a semântica atual de espera de reconexão de 45 s e resposta 503 (ERR_WAPP_NOT_AVAILABLE), agora via manager.getReady(whatsappId, timeoutMs).
- [ ] Manter V1MessageIdempotency somente como ponte de compatibilidade durante o rollout; MessageCommand passa a ser a autoridade.
- [ ] Na UI, manter o clientMessageId já existente para texto (randomUUID por tentativa, MessageInput/index.js linhas 188-201), adicionar clientBatchId para mídia, tratar a resposta 202 e limpar texto/arquivos somente após aceite.
- [ ] Executar as suítes de controller, InternalV1, serviço público, novo serviço, dispatcher e OutboundPairIntegration.
- [ ] Commit: feat(messaging): route every outbound message through outbox.

Mensagens de sistema fora do escopo desta task (ver §8): resposta automática a chamadas (wbotMonitor), encerramento de ticket (wbotClosedTickets) e transferência/aceite (UpdateTicketService).

### Task 5: Construir confirmação de entrega e saúde do canal

**Files:**

- Create: app/backend/src/messaging/outbox/DeliveryConfirmationRecoveryService.ts
- Create: app/backend/src/messaging/outbox/__tests__/DeliveryConfirmationRecoveryService.spec.ts
- Create: app/backend/src/database/migrations/20260804000001-add-whatsapp-delivery-health.ts
- Create: app/backend/src/database/migrations/__tests__/20260804000001-add-whatsapp-delivery-health.spec.ts
- Create: app/backend/src/messaging/application/ChannelDeliveryHealthService.ts
- Create: app/backend/src/messaging/application/__tests__/ChannelDeliveryHealthService.spec.ts
- Modify: app/backend/src/messaging/domain/MessagingStates.ts
- Modify: app/backend/src/messaging/outbox/MessagingRuntime.ts
- Modify: app/backend/src/messaging/outbox/OutboundPairRecoveryService.ts
- Modify: app/backend/src/models/Whatsapp.ts
- Modify: app/backend/src/messaging/application/BaileysDomainEventService.ts
- Modify: app/backend/src/services/WbotServices/wbotMessageListener.ts
- Modify: app/backend/src/services/MessageServices/ListMessagesService.ts
- Modify: app/frontend/src/components/MessagesList/index.js
- Modify: app/frontend/src/components/MessageInput/index.js

- [ ] Adicionar DELIVERY_UNCONFIRMED a MESSAGE_COMMAND_ERROR_CODE (hoje inexistente em todo o código).
- [ ] Definir a autoridade única de ACK: a cadeia BaileysProviderEventAdapter → BaileysDomainEventService passa a ser a única escritora de ACK; o handleMsgAck legado (wbotMessageListener.ts linha 2873) é desativado ou reduzido a no-op delegante, preservando-se a decisão explícita sobre o readMessages que ele executa hoje.
- [ ] RED: ACK processado pelos dois caminhos (legado e adapter) durante a transição não duplica evento nem regride estado.
- [ ] RED: ACK >= 2 transiciona MessageCommand sent (hoje nada atualiza o comando por ACK); ack 3 vira delivered; ack 4 vira read; eventos duplicados ou fora de ordem nunca regridem read/delivered.
- [ ] RED: comando sent com ack 0/1 após cinco minutos gera unknown + DELIVERY_UNCONFIRMED e evento de atualização (novo DeliveryConfirmationRecoveryService, registrado como RecoveryRunner no MessagingRuntime, no padrão de OutboundPairRecoveryService).
- [ ] RED: ACK tardio cura unknown, zera consecutiveUnconfirmed e restaura deliveryHealth=healthy.
- [ ] RED: duas falhas consecutivas em dez minutos degradam o canal; uma falha isolada não degrada canal previamente saudável.
- [ ] Atualizar Message e MessageCommand na mesma transação bloqueada por linha.
- [ ] Emitir a projeção delivery no GET e Socket.IO sem quebrar campos existentes.
- [ ] Renderizar relógio para queued/sending, checks distintos para sent/delivered/read e ícone vermelho com tooltip para unknown/failed.
- [ ] Texto do tooltip unknown: Entrega não confirmada pelo WhatsApp. Verifique o destinatário antes de tentar novamente.
- [ ] Exibir banner discreto no canal quando deliveryHealth=degraded, sem desabilitar o input.
- [ ] Executar as suítes de domínio, watchdog novo e existente, listagem e frontend.
- [ ] Commit: feat(messaging): add delivery confirmation watchdog and channel health.

### Task 6: Migrar autenticação para armazenamento por chave

**Files:**

- Create: app/backend/src/database/migrations/20260804000002-create-whatsapp-session-keys.ts
- Create: app/backend/src/database/migrations/__tests__/20260804000002-create-whatsapp-session-keys.spec.ts
- Create: app/backend/src/messaging/persistence/models/WhatsAppSessionKey.ts
- Create: app/backend/src/messaging/persistence/WhatsAppSessionKeyRepository.ts
- Create: app/backend/src/messaging/persistence/__tests__/WhatsAppSessionKeyRepository.spec.ts
- Create: app/backend/src/messaging/operations/WhatsAppSessionKeyBackfillCli.ts
- Create: app/backend/src/messaging/operations/__tests__/WhatsAppSessionKeyBackfillCli.spec.ts
- Modify: app/backend/src/helpers/authState.ts
- Modify: app/backend/src/database/index.ts
- Modify: app/backend/package.json
- Modify: app/backend/.env.example

- [ ] Criar tabela messaging.WhatsAppSessionKeys com chave primária composta whatsappId + keyType + keyId.
- [ ] Definir payloadEncrypted TEXT NOT NULL, revision BIGINT NOT NULL, generation BIGINT NOT NULL, createdAt e updatedAt.
- [ ] Usar keyType=creds e keyId=singleton para credenciais; aceitar qualquer categoria Baileys validada para chaves Signal.
- [ ] RED: set grava somente ids alterados, get lê somente ids solicitados e remoção persiste tombstone/delete sem regravar o conjunto.
- [ ] RED: upsert com revision/generation inferior não sobrescreve registro mais novo.
- [ ] RED: payload no banco nunca contém JSON em claro e decrypt usa encryptMessagingSecret/decryptMessagingSecret (messaging/security/MessagingSecretCipher.ts, já existente).
- [ ] RED: chave de criptografia ausente ou ciphertext inválido falha fechado e não inicia socket.
- [ ] Implementar modelo e repositório com transação, batch upsert e limite de tamanho.
- [ ] Criar backfill idempotente que lê Whatsapp.session, valida creds.me, criptografa cada entrada e emite apenas contagens.
- [ ] Adicionar modos MESSAGING_AUTH_STORE_MODE=json, dual_write, postgres.
- [ ] Em dual_write, ler PostgreSQL como principal após comparar digest; registrar divergência sem incluir payload.
- [ ] Executar canário de dual_write por 24 horas em homologação, exigindo zero divergências e zero escrita stale.
- [ ] Trocar para postgres; manter Whatsapp.session somente para rollback durante uma janela de sete dias.
- [ ] Agendar remoção do JSON legado em migração separada após a janela, não nesta task.
- [ ] Adicionar script npm backfill:whatsapp-session-keys seguindo o padrão do existente backfill:contact-lids: `node dist/messaging/operations/WhatsAppSessionKeyBackfillCli.js` (executa o artefato compilado, após build).
- [ ] Executar testes de repositório, backfill, authState, migration apply/rollback/reapply e build.
- [ ] Commit: feat(whatsapp): persist encrypted auth state per key.

### Task 7: Observabilidade e alertas

**Files:**

- Create: app/backend/src/messaging/operations/WhatsAppDeliveryTelemetry.ts
- Create: app/backend/src/messaging/operations/__tests__/WhatsAppDeliveryTelemetry.spec.ts
- Modify: app/backend/src/services/WbotServices/WhatsAppSessionManager.ts
- Modify: app/backend/src/messaging/application/ChannelDeliveryHealthService.ts
- Modify: app/backend/src/utils/logger.ts
- Modify: app/backend/src/app.ts
- Create: docs/operations/whatsapp-delivery-runbook.md

- [ ] Emitir métricas: active_socket_count, connect_attempt_total, reconnect_total por reasonCode, stale_callback_total, auth_write_failure_total, auth_revision_conflict_total, delivery_unconfirmed_total e ack_latency_ms.
- [ ] Identificar somente companyId, whatsappId, generation, commandId e códigos normalizados.
- [ ] RED: logger redige phone, jid, body, qr, session, creds, keys e payloadEncrypted.
- [ ] Alerta crítico quando active_socket_count > 1, qualquer stale auth write for aceita, ou taxa DELIVERY_UNCONFIRMED ultrapassar duas mensagens em dez minutos no canal.
- [ ] Alerta de aviso para 463/440 e sessão terminal.
- [ ] Runbook deve orientar: confirmar métricas, não reenviar automaticamente, testar mensagem controlada, verificar recebimento, encerrar sockets, limpar credencial apenas com autorização e refazer QR.
- [ ] Incluir queries SQL de diagnóstico sem retornar conteúdo de mensagem ou segredo.
- [ ] Commit: feat(operations): add whatsapp delivery telemetry and runbook.

### Task 8: Desempenho e limites operacionais

**Files:**

- Modify: app/backend/src/libs/wbot.ts
- Modify: app/backend/src/messaging/adapters/baileys/BaileysMessageCommandProvider.ts
- Modify: app/backend/src/messaging/outbox/MessagingRuntime.ts
- Modify: app/backend/src/messaging/outbox/__tests__/MessagingRuntime.spec.ts
- Create: app/backend/src/messaging/adapters/baileys/__tests__/BaileysSessionCaches.spec.ts

- [ ] Manter msgRetryCounterCache por sessão e definir TTL/tamanho máximo.
- [ ] Adicionar cache de device metadata/getMessage somente quando a biblioteca 6.7.24 expuser o hook correspondente; ausência do hook não autoriza upgrade nesta entrega.
- [ ] Limitar concorrência de dispatch por canal a uma lane ordenada; canais diferentes podem trabalhar em paralelo com limite configurável.
- [ ] Impedir que uma fila de canal desconectado bloqueie os demais.
- [ ] Medir tempo entre commit e dispatch, sendMessage e providerMessageId, e providerMessageId e ACK.
- [ ] RED: 100 comandos do mesmo canal preservam ordem; dois canais progridem de forma independente.
- [ ] RED: cache respeita limite e é descartado ao substituir a geração.
- [ ] Executar capacity:messaging apenas no ambiente aprovado e comparar p50/p95/p99 com baseline.
- [ ] Commit: perf(messaging): isolate channel lanes and bound baileys caches.

### Task 9: Verificação, homologação e rollout

**Files:**

- Modify: docs/operations/messaging-deployment.md
- Modify: docs/operations/whatsapp-delivery-runbook.md
- Create: docs/operations/evidence/whatsapp-delivery-hardening.md

- [ ] Executar testes focados de todas as tasks.
- [ ] Executar em app/backend:

    npm run build
    npm run lint
    npm run check:messaging-boundaries
    npm run check:messaging-architecture
    npm run check:boundary-fixtures
    npm test -- --runInBand

- [ ] Executar no frontend:

    cd app/frontend
    CI=true npm test -- --watchAll=false
    npm run build
- [ ] Confirmar migration apply, rollback e reapply no job PostgreSQL 16 da CI.
- [ ] Confirmar CI completa verde antes do deploy.
- [ ] Em homologação, disparar simultaneamente boot + dez solicitações de conectar e comprovar activeSocketCount=1 e um único QR.
- [ ] Em homologação com duas réplicas, iniciar o mesmo canal nas duas e comprovar uma única lease, um único fencingToken vigente e um único socket proprietário.
- [ ] Reiniciar backend três vezes e confirmar uma sessão por boot, recebimento funcional e ausência de divergência de auth.
- [ ] Enviar texto, resposta citada e lote de três mídias; todos devem obter ack >= 2 dentro da janela normal e nenhum eco fromMe pode duplicar a mensagem na conversa.
- [ ] Simular ausência de ACK com provider fake: UI vira unknown após cinco minutos, canal degrada na segunda ocorrência e não há resend/restart.
- [ ] Simular ACK tardio: mensagem e canal se recuperam sem duplicar entrega.
- [ ] Simular 408/428/515 e comprovar uma reconexão; simular 401/403/440/463 e comprovar ausência de loop.
- [ ] Liberar por feature flags: session manager, unified outbox, delivery UI e postgres auth store separadamente.
- [ ] Canário inicial: um canal interno por 24 horas; depois 10% dos canais por 24 horas; depois 50%; depois 100%.
- [ ] Rollback de aplicação pode voltar cada flag. Rollback do auth store volta para dual_write/json somente durante a janela com comparação de revisão; nunca restaurar snapshot antigo sobre revisão nova.
- [ ] Registrar SHA, migrations aplicadas, resultados, gráficos e decisão go/no-go no arquivo de evidência.
- [ ] Commit: docs(operations): record whatsapp delivery rollout evidence.

## 7. Critérios de aceite

A entrega só pode ser declarada concluída quando todos os itens abaixo tiverem evidência:

- nenhuma combinação de boot, clique, reconnect ou duas réplicas produz mais de um socket proprietário por canal;
- nenhum callback ou save de geração antiga consegue alterar estado, e todos os pontos de registro de listeners foram inventariados e cercados por geração;
- ausência de lease (PostgreSQL indisponível) não abre socket;
- UI, /api/messages/send, /api/v1/messages e automações de webhook convergem no MessageCommandDispatcher;
- o eco messages.upsert fromMe nunca duplica mensagem criada pelo comando;
- existe uma única autoridade de ACK, e o comando acompanha sent → delivered → read;
- retry idempotente não duplica texto, mídia ou lote;
- 202 significa persistência durável e não é apresentado como entregue;
- ack 0/1 expirado fica visível como unknown com DELIVERY_UNCONFIRMED;
- ack >= 2 restaura saúde e ACK tardio corrige o estado;
- degradação por ACK apenas alerta;
- falha transitória de transporte reconecta com limite; falha terminal não entra em loop; 440 não apaga credencial;
- armazenamento PostgreSQL por chave está criptografado, cercado por geração/revisão e sem divergência no canário;
- logs e alertas não contêm PII ou segredo;
- CI, build, testes e migrations estão verdes.

## 8. Fora de escopo

- atualizar para Baileys 7;
- afirmar que o WhatsApp garante entrega apenas por connection=open;
- reenvio automático de mensagem unknown;
- reinício automático motivado apenas por falta de ACK;
- bloqueio automático do input quando deliveryHealth=degraded;
- remoção imediata da coluna Whatsapp.session antes da janela de rollback;
- alterar contratos públicos de forma incompatível;
- reproduzir payload bruto da Evolution API;
- migrar mensagens de sistema para o outbox nesta entrega: resposta automática a chamadas de voz (wbotMonitor, sendBaileysSocketMessage), mensagem de encerramento de ticket (wbotClosedTickets) e mensagens de transferência/aceite (UpdateTicketService). Justificativa: são fluxos unidirecionais de notificação sem interação do operador; mantê-los fora preserva o foco nas causas do incidente. Eles continuam funcionando pelo caminho atual via manager.getReady e devem ser reavaliados em entrega posterior — registrados aqui para que nenhum envio direto permaneça invisível.

## 9. Referências técnicas

- Evolution API: https://github.com/evolution-foundation/evolution-api
- PR Evolution sobre connectionReplaced e lock de reconnect: https://github.com/evolution-foundation/evolution-api/pull/2655
- PR Evolution sobre fechamento do socket anterior: https://github.com/evolution-foundation/evolution-api/pull/2656
- Issue Evolution sobre mensagens presas em PENDING: https://github.com/evolution-foundation/evolution-api/issues/2597
- Issue Baileys sobre tokens de confiança ausentes/obsoletos e erro 463: https://github.com/WhiskeySockets/Baileys/issues/2441

Essas referências servem como evidência de padrões e riscos, não como prova de que a Evolution API eliminou o problema. Os PRs abertos mostram que single-flight, fechamento da sessão anterior e reconexão concorrente também precisam de tratamento explícito naquela base.
