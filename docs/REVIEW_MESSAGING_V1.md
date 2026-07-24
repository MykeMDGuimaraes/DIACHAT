# Code Review — Branch `codex/messaging-v1`

**Data:** 24/07/2026
**Escopo:** `main..origin/codex/messaging-v1` — 11 commits, 193 arquivos, +8.859 / −996 linhas
**Revisor:** Arquitetura (Replit Agent) — avaliação contra o plano aprovado de Messaging v1 (monólito modular)
**Veredito:** ⛔ **Aprovar com ressalvas bloqueantes — NÃO mergear até resolver B1 e B2.**

---

## 1. Sumário executivo

O trabalho entrega a espinha dorsal do Messaging v1 com qualidade acima da média: monólito modular respeitado, outbox transacional, inbox durável para Meta Cloud, API pública `/api/v1` com credenciais hasheadas/scopes/rate-limit, webhooks externos com HMAC + proteção SSRF, e criptografia AES-256-GCM em repouso. A cobertura de testes é extensa e as decisões seguem o ADR.

Há, porém, **uma falha crítica de confiabilidade no caminho outbound** (todo erro do provider é tratado como `unknown` terminal, sem retry — o que reintroduz perda silenciosa de mensagem, exatamente o que o outbox existe para impedir) e **um risco alto de merge** (a branch foi cortada de uma `main` antiga e reverte mudanças de frontend já em produção de desenvolvimento). Ambos têm correção pequena em relação ao tamanho do trabalho.

---

## 2. O que atende 100% das expectativas

### 2.1 Monólito modular — ✅
- Todo o código novo vive em `app/backend/src/messaging/` (adapters, application, api, channels, outbox, webhooks, operations, persistence), integrado ao runtime existente via `src/server.ts`.
- **Nenhum** segundo stack (NestJS/Prisma/PM2) foi introduzido — conforme o veto da revisão de plano.
- ADR registrado em `docs/adr/0001-messaging-modular-monolith.md`.

### 2.2 Outbox transacional (escrita) — ✅
- `messaging/application/PublicTextMessageService.ts`: mensagem local, `MessageCommand` e evento `message.dispatch.requested` são gravados **na mesma transação** — sem ping-pong HTTP, sem janela de inconsistência.
- Idempotência estilo Stripe presente no caminho da API pública.

### 2.3 Concorrência dos workers — ✅
- `MessageCommandDispatcher.claimNext` usa `FOR UPDATE SKIP LOCKED` (`lock: transaction.LOCK.UPDATE` + `skipLocked: true`) com lease de 120s em comando **e** evento, dentro de uma única transação. Correto: dois workers não pegam o mesmo trabalho e um crash não deixa lock preso.
- Mesmo padrão em `MetaInboxProcessor`, `WebhookFanoutService` e `WebhookDeliveryDispatcher`.

### 2.4 Inbox Meta durável — ✅
- `IngestMetaWebhookService` persiste o evento **bruto antes** de qualquer processamento (ack rápido ao Meta, processamento assíncrono com lease/retry — migração `20260724000009-add-messaging-inbox-leases`).
- `MetaWebhookSignature`: HMAC SHA-256 sobre o **raw body** com `crypto.timingSafeEqual` — timing-safe, correto.
- Challenge GET (`hub.verify_token`) implementado em `MetaWebhookVerificationService`.

### 2.5 API pública `/api/v1` — ✅
- `apiKeyAuth` (credencial hasheada, nunca em claro no banco), `requireApiScope` (escopos), `publicApiRateLimit` (limites por credencial, migração `...0007-add-messaging-rate-limits`).
- `legacyApiDeprecation`: o endpoint legado `/api/messages/send` recebeu **janela de deprecação com headers**, não um `410` imediato — conforme solicitado na revisão do plano.

### 2.6 Webhooks externos — ✅
- Models novos `WebhookSubscription`/`WebhookDelivery` (migração `...0005-create-external-webhooks`) — **não** reutilizou o model `Webhook` legado acoplado ao FlowBuilder. Correto.
- Assinatura `timestamp.raw_body` (HMAC), retries com backoff e dead-letter.
- `WebhookUrlPolicy` + `WebhookDeliveryDispatcher`: validação de destino com **resolução DNS + pinning de IP** na hora do envio — mitiga SSRF e DNS rebinding (não só blocklist de hostname). Implementação acima do padrão usual.

### 2.7 Criptografia em repouso — ✅
- `MessagingSecretCipher`: AES-256-GCM com keyring e suporte a rotação; tokens Meta nunca em claro (`...0003-create-meta-cloud-credentials`).

### 2.8 Operação e documentação — ✅
- Gate de capacidade: `scripts/messagingCapacityGate.js` + amostras persistidas (`MessagingCapacitySample`) + doc `docs/operations/messaging-capacity-gate.md`.
- `docs/operations/messaging-deployment.md`, `docs/api/README.md`, design doc de conclusão. CI de fronteira em `.github/workflows/messaging-boundaries.yml`.

---

## 3. Onde precisa melhorar — com severidade e justificativa

### B1 — 🔴 CRÍTICO (bloqueante): outbound sem retry — erro transitório vira `unknown` terminal

**Onde:** `messaging/outbox/MessageCommandDispatcher.ts`, `dispatchOne()`:

```ts
} catch (error) {
  const reason = error instanceof Error ? error.message : "unknown provider error";
  await this.dependencies.markUnknown(claimed.command.id, claimed.eventId, reason);
  return { status: "unknown" };
}
```

E `markUnknown` faz:

```ts
status: "unknown", errorCode: "SEND_OUTCOME_UNKNOWN", ...
// e no evento:
status: "completed"   // <-- evento CONCLUÍDO, nunca mais reprocessado
```

**Problema:** *qualquer* exceção do provider — incluindo `ECONNREFUSED`, timeout de conexão, HTTP 429/500 da Graph API, socket Baileys momentaneamente desconectado — encerra o comando como `unknown` e marca o evento outbox como `completed`. Resultado: **mensagem perdida silenciosamente**, sem retry e sem alarme forte. Isso viola o requisito central do outbox ("no lost sends") e esvazia o propósito do estado `unknown`, que no plano aprovado era reservado para ambiguidade **real** (ex.: timeout *depois* do request ter partido, quando não se sabe se o Meta recebeu).

**Correção esperada:**
1. Classificar erros em três categorias no adapter (o adapter sabe; o dispatcher não):
   - `RetryableSendError` — falha **antes** de o request partir (DNS, conexão recusada, 429, 5xx com corpo de erro claro): recolocar o evento em `ready` com `availableAt = now + backoff(attemptCount)` (exponencial + jitter) e comando de volta a `queued`;
   - `PermanentSendError` — 4xx determinístico (token inválido, número não-whatsapp, template rejeitado): `status: "failed"` com `errorCode` específico + evento `message.failed` no outbox para o fanout de webhooks;
   - Ambíguo (timeout pós-envio, resposta ilegível) — aí sim `unknown`, **sem** retry automático (regra do plano: nunca reenviar `unknown` automaticamente, risco de duplicata).
2. Limite de tentativas (ex.: 8) com dead-letter + métrica/alarme.
3. `attemptCount` já é incrementado no claim — aproveitar para o cálculo do backoff.
4. Testes: hoje `MessageCommandDispatcher.spec.ts` cobre o caminho `unknown` genérico; adicionar casos por categoria (retryable → volta a `ready` com `availableAt` futuro; permanent → `failed`; ambíguo → `unknown`).

**Por que é bloqueante:** em produção, uma oscilação de rede de 30s durante um pico de campanha silenciosamente descarta todas as mensagens do período — e o painel mostrará tudo "processado". É o pior modo de falha possível para um gateway de mensageria: perda invisível.

---

### B2 — 🔴 ALTO (bloqueante): a branch reverte mudanças recentes da `main` (frontend)

A branch foi cortada de uma `main` anterior a 24/07. O diff `main..branch` mostra que o merge, como está, **clobbera**:

| Arquivo | O que a `main` tem hoje | O que o merge faria |
|---|---|---|
| `app/frontend/src/assets/logo.png` | Logo novo D.IA CHAT 512px | Reverte para a arte antiga 227px |
| `app/frontend/public/favicon.ico` + 5 ícones | Ícones gerados do logo novo | Substitui por binários antigos/errados |
| `app/frontend/public/index.html` | `apple-touch-icon.jpg` corrigido | Reverte referência quebrada `.png` |
| `src/pages/Login/index.js` | Fundo dark-mode `#1C1C1C`, rodapé CNPJ Dia Solutions, botão flutuante WhatsApp | Remove os três |
| `src/pages/Signup/index.js` | Rodapé CNPJ | Remove |
| `src/translate/i18n.js` | Default `pt` | Volta para `en` |
| `attached_assets/*` | Assets presentes | Deleta |

**Correção esperada:** `git rebase origin/main` (ou merge de `main` na branch) resolvendo conflitos **sempre a favor da `main`** nos arquivos de frontend/branding acima — a branch não deveria tocar em frontend de branding; se tocou por acidente de base, restaurar. Conferir depois com:

```bash
git diff origin/main..codex/messaging-v1 -- app/frontend/src/assets app/frontend/public \
  app/frontend/src/pages/Login app/frontend/src/pages/Signup app/frontend/src/translate
# saída esperada: apenas as mudanças intencionais do messaging-v1 (modais de conexão etc.)
```

---

### M1 — 🟠 ALTO (não bloqueante, mas com prazo): o guard de fronteira é raso demais para sustentar o monólito modular

**Onde:** `scripts/checkMessagingBoundaries.js`.

Hoje o script só valida, por regex, duas regras:
1. proibição de `import ... from "baileys"` fora de `messaging/adapters/baileys`;
2. proibição de `.sendMessage(` fora dos adapters.

**O que falta:** a condição para aprovarmos o monólito modular (em vez de um serviço separado) foi uma **fronteira estrutural verificada em CI**. As regras que ainda não são verificadas:
- **core → messaging:** código fora de `src/messaging/` só pode importar os pontos de entrada públicos do módulo (ex.: `messaging/ports/*` ou um `messaging/index.ts` explícito) — nunca internals (`messaging/persistence/models/*`, `messaging/outbox/*` etc.);
- **messaging → core:** código dentro de `src/messaging/` só pode importar do core uma allowlist declarada (ex.: `database`, `models/Message`, `models/Ticket`, `libs/socket`) — qualquer import novo do core exige mudança consciente na allowlist (revisável em PR);
- regex de `.sendMessage(` gera falso negativo trivial (`const s = sock; s["send" + "Message"](...)`) e falso positivo em qualquer outro objeto com método homônimo. Análise por **grafo de imports** (ex.: `dependency-cruiser`, que já roda bem em TS + CI) resolve as duas coisas.

**Por que importa:** sem isso a fronteira erode silenciosamente — em 6 meses o `messaging/` estará acoplado ao core em dezenas de pontos e a opção "extrair para serviço quando a escala exigir" (registrada no ADR) deixa de existir na prática.

**Sugestão concreta:** adicionar `dependency-cruiser` com regras `core-nao-importa-internals-de-messaging` e `messaging-so-importa-allowlist-do-core`, rodando no mesmo workflow `messaging-boundaries.yml`. Manter o script atual como verificação complementar do Baileys.

---

### M2 — 🟡 MÉDIO: métricas contam estados que o runtime não usa

**Onde:** `messaging/operations/MessagingMetricsService.ts`:

```ts
MessageCommand.count({ where: { ...companyWhere, status: "leased" } }),
MessagingOutboxEvent.count({ where: { ...companyWhere, status: "leased" } }),
// e oldestCommand/oldestOutbox filtram por ["queued"|"ready", "leased"]
```

Mas o `MessageCommandDispatcher` transiciona comando para **`sending`** e evento para **`processing`** — nunca `leased`. Consequência: os contadores "in-flight" ficam **sempre em zero** e `oldestAgeSeconds` ignora trabalho em andamento; um travamento de worker com 500 comandos presos em `sending` apareceria como sistema saudável.

**Correção:** alinhar os filtros aos estados reais (`sending`/`processing`), ou — melhor — extrair um enum/constante compartilhado de estados usado por dispatcher, recovery e métricas, para o compilador impedir a divergência. Adicionar um teste de métrica que crie um comando `sending` e verifique que o contador in-flight ≥ 1.

---

### M3 — 🟡 MÉDIO: `markUnknown`/`markSent` condicionados a `status: "sending"` — verificar o caminho do recovery

`markSent`/`markUnknown` usam `where: { id, status: "sending" }`. Correto contra corrida (lease expirado + recovery), **mas**: se o `MessageCommandRecoveryService` recolocar um comando com lease vencido em `queued` enquanto o worker original ainda está vivo e conclui o envio, o `markSent` vira no-op silencioso e o comando será **reenviado** (duplicata). Mitigação padrão: token de lease (UUID por claim) verificado no `where` do update, ou aceitar a duplicata rara e documentá-la (o plano exigia idempotência ponta-a-ponta — o provider Meta aceita `biz_opaque_callback_data` para deduplicação no consumidor). Não bloqueia, mas precisa de decisão registrada e teste.

### m1 — 🟢 BAIXO: higiene

- `buildMessageSentEvent(command: any, ...)` — tipar (`MessageCommand` ou DTO) para não perder o compilador no payload do evento público.
- Encoding: strings pt-BR com mojibake em mensagens de erro (ex.: `nÃ£o suportado` em `MessageCommandDispatcher`) — arquivo salvo com encoding errado em pelo menos um ponto; padronizar UTF-8.
- Vírgula órfã / formatação irregular no destructuring de `MessagingMetricsService.collect` (`oldestWebhook\n,\ncapacityReady`) — rodar prettier/eslint do projeto na árvore nova.

---

## 4. Segurança — sem achados bloqueantes

Verificado explicitamente, sem violações encontradas:
- Comparações de assinatura timing-safe (`timingSafeEqual`) tanto no webhook Meta quanto nos webhooks externos;
- Assinatura calculada sobre **raw body** (antes do parse JSON);
- Segredos Meta com AES-256-GCM + keyring; API keys armazenadas como hash;
- SSRF: resolução DNS com pinning de IP e bloqueio de faixas privadas no dispatcher de entrega — cobre redirect e rebinding;
- Multi-tenant: os fluxos novos carregam `companyId` nas tabelas e queries (atenção contínua: este codebase já teve bugs cross-tenant; manter o padrão "404 em cross-tenant" nos controllers admin novos).

---

## 5. Checklist para liberar o merge

- [ ] **B1** — Retry/backoff no outbound com taxonomia `retryable / permanent / unknown` + testes por categoria + dead-letter com alarme
- [ ] **B2** — Rebase na `main` atual; diff de frontend limpo (comando da seção 3.B2)
- [ ] **M1** — Fronteira por grafo de imports no CI (pode entrar como follow-up imediato, mas com issue aberta antes do merge)
- [ ] **M2** — Métricas alinhadas aos estados reais + teste
- [ ] **M3** — Decisão registrada (lease token vs. duplicata documentada) 
- [ ] Rodar suíte completa + capacity gate após o rebase

**Recomendação final:** o núcleo do trabalho é sólido e fiel ao plano — com B1 e B2 resolvidos, aprovado para merge; M1/M2 podem entrar na sequência imediata desde que rastreados.
