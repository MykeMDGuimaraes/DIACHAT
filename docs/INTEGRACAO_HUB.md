# Guia de Integração — Hub Fala Caminhoneiro × DIA CHAT

Documentação da API interna `/internal/v1` do DIA CHAT para o time do Hub (BFF + frontend). Este documento é autossuficiente: contém tudo o que é necessário para integrar autenticação, contatos, conversas, mensagens, envio idempotente, eventos em tempo real (SSE) e anexos.

Todos os exemplos deste guia foram capturados contra o backend em execução.

---

## 1. Visão geral da arquitetura

- O **DIA CHAT** é o backend-core **multi-tenant** de atendimento (WhatsApp). Cada cliente/empresa é um *tenant* (`companyId`).
- O **Hub (BFF)** consome o DIA CHAT exclusivamente pela API interna `/internal/v1`, autenticado por **credencial de serviço** escopada a um único tenant.
- Todo dado retornado é automaticamente filtrado pelo tenant da credencial — o Hub nunca envia `companyId`; tentar acessar recursos de outro tenant resulta em `404`/`401`.
- Base URL: a URL do backend do DIA CHAT (porta 3001 em desenvolvimento). Exemplos abaixo usam `https://SEU-BACKEND` como placeholder.

```
Frontend do caminhoneiro ⇄ BFF do Hub ⇄ (Bearer tokenId.secret) ⇄ DIA CHAT /internal/v1 ⇄ WhatsApp
```

## 2. Autenticação (credencial de serviço)

Toda chamada a `/internal/v1/*` exige o header:

```
Authorization: Bearer <tokenId>.<secret>
```

O token tem o formato `svc_xxxxxxxx.yyyyyyyy` (tokenId + "." + secret).

### Como obter a credencial
1. Um **super admin** do DIA CHAT cria a credencial via `POST /service-credentials` (fora do escopo `/internal/v1`), informando `name` e `companyId` do tenant.
2. A resposta traz o campo `token` (`tokenId.secret`) — **exibido uma única vez**. O DIA CHAT armazena apenas o hash do secret; não há como recuperar o token depois.
3. Credenciais podem ser revogadas a qualquer momento (`revokedAt`); após revogação, toda chamada retorna `401`.

### Boas práticas no Hub
- Guarde o token em um cofre de segredos/variável de ambiente do BFF. **Nunca** exponha ao frontend.
- Todas as chamadas ao DIA CHAT devem partir do BFF (server-to-server).
- Em caso de vazamento, peça a revogação e a emissão de uma nova credencial.

### Erros de autenticação
| Situação | Status | `error.code` | `error.message` |
|---|---|---|---|
| Header ausente ou sem `Bearer` | 401 | `UNAUTHORIZED` | `ERR_SERVICE_CREDENTIAL_REQUIRED` |
| Token malformado, desconhecido, secret errado ou credencial revogada | 401 | `UNAUTHORIZED` | `ERR_INVALID_SERVICE_CREDENTIAL` |

Exemplo real:
```json
{"error":{"code":"UNAUTHORIZED","message":"ERR_INVALID_SERVICE_CREDENTIAL"}}
```

## 3. Convenções gerais

- **Formato**: JSON UTF-8. Respostas de sucesso têm envelope `{"data": ...}`; listagens têm também `"nextCursor"`.
- **Erros**: envelope `{"error": {"code", "message", "details"?}}` (ver tabela na seção 9).
- **Paginação por cursor**: `?limit=` (1–100, padrão 20) e `?cursor=` (string opaca retornada em `nextCursor`). Quando `nextCursor` é `null`, não há mais páginas. Trate o cursor como opaco — não decodifique nem construa manualmente.
- **Datas**: ISO 8601 UTC (`2026-07-21T21:39:43.894Z`).

## 4. Endpoints REST

### 4.1 `GET /internal/v1/contacts` — listar contatos

Query params: `limit` (1–100, padrão 20), `cursor`, `search` (busca por nome ou número).

```bash
curl "https://SEU-BACKEND/internal/v1/contacts?limit=2" \
  -H "Authorization: Bearer $TOKEN"
```

Resposta real (200):
```json
{
  "data": [
    {
      "id": 13,
      "name": "João Caminhoneiro",
      "number": "5511999998888",
      "email": null,
      "isGroup": false,
      "profilePicUrl": null,
      "createdAt": "2026-07-21T21:39:43.894Z",
      "updatedAt": "2026-07-21T21:39:43.894Z"
    }
  ],
  "nextCursor": null
}
```

### 4.2 `GET /internal/v1/conversations` — listar conversas

Query params: `limit`, `cursor`, `status` (`open` | `pending` | `closed`). Ordenação: mais recentemente atualizadas primeiro.

```bash
curl "https://SEU-BACKEND/internal/v1/conversations?status=open&limit=2" \
  -H "Authorization: Bearer $TOKEN"
```

Resposta real (200):
```json
{
  "data": [
    {
      "id": 16,
      "uuid": "3cff2d94-d077-4ea3-a8a8-7a2eb4b82c8a",
      "status": "open",
      "unreadCount": 1,
      "lastMessage": "Obrigado!",
      "isGroup": false,
      "contact": {
        "id": 13,
        "name": "João Caminhoneiro",
        "number": "5511999998888",
        "email": null,
        "isGroup": false,
        "profilePicUrl": null,
        "createdAt": "2026-07-21T21:39:43.894Z",
        "updatedAt": "2026-07-21T21:39:43.894Z"
      },
      "queueId": null,
      "userId": null,
      "whatsappId": null,
      "createdAt": "2026-07-21T21:39:44.026Z",
      "updatedAt": "2026-07-21T21:39:44.026Z"
    }
  ],
  "nextCursor": null
}
```

### 4.3 `GET /internal/v1/conversations/:conversationId` — detalhar conversa

Retorna o mesmo objeto de conversa acima em `{"data": {...}}`. Conversa inexistente **ou de outro tenant** → `404 NOT_FOUND`.

### 4.4 `GET /internal/v1/conversations/:conversationId/messages` — listar mensagens

Query params: `limit`, `cursor`. Ordenação: **mais recentes primeiro** (para carregar histórico, siga `nextCursor` que anda para trás no tempo).

```bash
curl "https://SEU-BACKEND/internal/v1/conversations/16/messages?limit=3" \
  -H "Authorization: Bearer $TOKEN"
```

Resposta real (200):
```json
{
  "data": [
    {
      "id": "docfix-media-347324",
      "conversationId": 16,
      "direction": "in",
      "body": "comprovante",
      "mediaType": "image",
      "mediaUrl": "/public/comprovante.jpeg",
      "ack": 2,
      "read": true,
      "isDeleted": false,
      "isEdited": false,
      "quotedMessageId": null,
      "contactId": 13,
      "createdAt": "2026-07-21T21:39:44.112Z",
      "updatedAt": "2026-07-21T21:39:44.112Z"
    },
    {
      "id": "docfix-msg-4-93eaa3",
      "conversationId": 16,
      "direction": "out",
      "body": "Obrigado!",
      "mediaType": "chat",
      "mediaUrl": null,
      "ack": 2,
      "read": true,
      "isDeleted": false,
      "isEdited": false,
      "quotedMessageId": null,
      "contactId": 13,
      "createdAt": "2026-07-21T21:32:44.105Z",
      "updatedAt": "2026-07-21T21:39:44.105Z"
    },
    {
      "id": "docfix-msg-3-572c5a",
      "conversationId": 16,
      "direction": "in",
      "body": "Pedido 12345",
      "mediaType": "chat",
      "mediaUrl": null,
      "ack": 2,
      "read": true,
      "isDeleted": false,
      "isEdited": false,
      "quotedMessageId": null,
      "contactId": 13,
      "createdAt": "2026-07-21T21:31:44.098Z",
      "updatedAt": "2026-07-21T21:39:44.098Z"
    }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2LTA3LTIxVDIxOjMxOjQ0LjA5OFoiLCJpZCI6ImRvY2ZpeC1tc2ctMy01NzJjNWEifQ"
}
```

Campos da mensagem:
| Campo | Significado |
|---|---|
| `id` | id da mensagem no WhatsApp (string) |
| `direction` | `in` = recebida do contato; `out` = enviada pelo atendimento/Hub |
| `body` | texto (ou legenda do anexo) |
| `mediaType` | `chat` (texto), `image`, `video`, `audio`, `application` etc. |
| `mediaUrl` | caminho relativo do anexo (`/public/...`) ou `null` — ver seção 7 |
| `ack` | confirmação de entrega: 0 pendente, 1 enviado, 2 entregue, 3 lido, 4/5 lido/reproduzido (estados avançados, dependem do provedor) |
| `quotedMessageId` | id da mensagem citada (reply), se houver |

### 4.5 `POST /internal/v1/conversations/:conversationId/messages` — enviar mensagem

Envio **idempotente** via `clientMessageId` (obrigatório, string única gerada pelo Hub, até 191 caracteres — use UUID).

Texto (JSON):
```bash
curl -X POST "https://SEU-BACKEND/internal/v1/conversations/16/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"clientMessageId":"1b1a4a9e-7d4f-4f7c-9a44-1c2f3d4e5f60","body":"Olá do Hub"}'
```

Com anexo (multipart/form-data, campo de arquivo `media`; `body` vira a legenda e é opcional):
```bash
curl -X POST "https://SEU-BACKEND/internal/v1/conversations/16/messages" \
  -H "Authorization: Bearer $TOKEN" \
  -F clientMessageId="9f2b..." -F body="Segue o comprovante" -F media=@comprovante.jpg
```

Respostas:
- **201** — enviado agora. Corpo: `{"data": {"id", "clientMessageId", "conversationId", "duplicate": false, "message": {...}}}` (`message` no formato da seção 4.4).
- **200 com `duplicate: true`** — replay: este `clientMessageId` já foi enviado antes; retorna a mensagem original, **não envia de novo**. Reenviar após timeout/erro de rede é seguro e é o comportamento esperado.
- **409 `REQUEST_IN_PROGRESS`** — um envio com o mesmo `clientMessageId` ainda está em processamento. Aguarde e repita.
- **422 `CONVERSATION_NOT_SENDABLE`** — a conversa não tem conexão WhatsApp associada (ex.: conversa importada/inativa). Exemplo real: `{"error":{"code":"CONVERSATION_NOT_SENDABLE","message":"Conversa não possui conexão WhatsApp associada"}}`
- **502 `SEND_FAILED`** — falha no canal WhatsApp; a reserva de idempotência é desfeita e **pode-se repetir com o mesmo `clientMessageId`**.
- **400 `VALIDATION_ERROR`** — ex.: sem `clientMessageId`: `{"error":{"code":"VALIDATION_ERROR","message":"clientMessageId é obrigatório (string de até 191 caracteres)"}}`

Receita de resiliência no BFF: gere o `clientMessageId` **antes** da primeira tentativa, persista-o junto ao comando de envio e reutilize-o em todas as retentativas (com backoff). 200/201 = sucesso; 409 = aguardar e repetir; 502 = repetir.

## 5. Eventos em tempo real — SSE `GET /internal/v1/events`

Stream `text/event-stream` com os eventos do tenant. Autenticação igual ao REST.

```bash
curl -N "https://SEU-BACKEND/internal/v1/events?cursor=0" \
  -H "Authorization: Bearer $TOKEN" -H "Accept: text/event-stream"
```

### Formato dos eventos
Cada evento SSE tem `id` (sequência numérica crescente por tenant), `event` (tipo) e `data` (JSON completo). Exemplo real:

```
retry: 3000

id: 2
event: conversation.updated
data: {"id":2,"type":"conversation.updated","occurredAt":"2026-07-21T21:41:05.000Z","payload":{"conversation":{"id":16,"status":"open"}}}
```

### Tipos de evento
| `event` | `payload` | Quando ocorre |
|---|---|---|
| `message.created` | `{ message, conversation }` | nova mensagem (recebida ou enviada) na conversa |
| `message.updated` | `{ message }` | atualização de status/ack de uma mensagem |
| `conversation.updated` | `{ conversation }` | mudança de status/atribuição da conversa |
| `contact.updated` | `{ contact }` | contato criado/atualizado |

`message`, `conversation` e `contact` usam exatamente os mesmos formatos das seções 4.x.

### Cursor e reconexão
- O cursor é o `id` do último evento processado. Na reconexão, envie `?cursor=<id>` **ou** o header `Last-Event-ID` (o `EventSource` do navegador/Node envia automaticamente).
- `cursor=0` (ou omitido) = **somente eventos ao vivo**, sem backlog.
- Com `cursor>0`, o servidor entrega primeiro o backlog retido (janela de ~500 eventos / 1 hora por tenant) e depois segue ao vivo.
- Heartbeat: comentário `: heartbeat <timestamp>` a cada 25 s — use para detectar conexão morta. O stream envia `retry: 3000` (reconexão sugerida em 3 s).

### Evento `resync` — o consumidor deve re-sincronizar
Se o cursor estiver fora da janela de retenção, o servidor envia:

```
event: resync
data: {"reason":"CURSOR_OUT_OF_WINDOW","latestSeq":123}
```

Motivos: `CURSOR_OUT_OF_WINDOW` (parte do intervalo foi descartada), `CURSOR_AHEAD_OF_SEQUENCE` (sequência do servidor foi reiniciada — exemplo real: `{"reason":"CURSOR_AHEAD_OF_SEQUENCE","latestSeq":2}`), `BACKLOG_UNAVAILABLE` (falha temporária no backlog).

Ao receber `resync`, o Hub deve: (1) re-sincronizar o estado via REST (listar conversas e mensagens recentes); (2) passar a usar `latestSeq` (quando presente) como novo cursor e continuar consumindo o stream ao vivo.

Erro de validação: `?cursor=abc` → `400 {"error":{"code":"VALIDATION_ERROR","message":"cursor deve ser um inteiro >= 0"}}`.

## 6. Auditoria (o que fica registrado)

Cada chamada do Hub gera registros de auditoria no DIA CHAT contendo **apenas identificadores** — nunca o conteúdo das mensagens: uso da credencial (`service.auth`, com tokenId, método e caminho), envios (`v1.message.send`, com `clientMessageId`, conversa e flag de anexo), acessos a mídia (`media.access`) e tentativas negadas (credencial inválida/revogada). Nenhuma ação extra é exigida do Hub; isto é informativo para fins de conformidade.

## 7. Anexos / mídia — estado atual

- Mensagens com anexo trazem `mediaUrl` relativo, ex.: `"/public/comprovante.jpeg"` (concatene com a base URL do backend).
- **Hoje o download exige JWT de usuário da interface do DIA CHAT** (query `?token=` ou header); a **credencial de serviço ainda não dá acesso** a `/public/*` — chamadas com ela retornam `401`.
- Acesso a anexos via credencial de serviço é **trabalho futuro** já mapeado. Até lá, o Hub pode exibir metadados do anexo (`mediaType`, nome no `mediaUrl`) sem o binário.

## 8. Início rápido (passo a passo)

```bash
# 0) Receba do time DIA CHAT a credencial de serviço (criada por um super admin
#    via POST /service-credentials; o token só aparece na criação):
export TOKEN="svc_xxxxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyy..."
export BASE="https://SEU-BACKEND"

# 1) Teste a credencial listando conversas abertas
curl "$BASE/internal/v1/conversations?status=open&limit=5" -H "Authorization: Bearer $TOKEN"

# 2) Carregue as mensagens de uma conversa (id vindo do passo 1)
curl "$BASE/internal/v1/conversations/16/messages?limit=20" -H "Authorization: Bearer $TOKEN"
# ... siga "nextCursor" para paginar o histórico

# 3) Envie uma mensagem (idempotente)
curl -X POST "$BASE/internal/v1/conversations/16/messages" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"clientMessageId\":\"$(uuidgen)\",\"body\":\"Olá! Aqui é o Hub.\"}"

# 4) Consuma eventos em tempo real (cursor=0 = só ao vivo)
curl -N "$BASE/internal/v1/events?cursor=0" -H "Authorization: Bearer $TOKEN"
# guarde o último "id:" recebido e reconecte com ?cursor=<id>
```

## 9. Tabela de erros

| Status | `error.code` | Quando | Ação recomendada no Hub |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | parâmetro inválido (limit, cursor, body, clientMessageId…) | corrigir a chamada; não repetir igual |
| 401 | `UNAUTHORIZED` | credencial ausente, inválida ou revogada | verificar/renovar credencial |
| 404 | `NOT_FOUND` | recurso inexistente **ou de outro tenant** | tratar como inexistente |
| 409 | `REQUEST_IN_PROGRESS` | envio com o mesmo `clientMessageId` em processamento | aguardar (backoff) e repetir |
| 422 | `CONVERSATION_NOT_SENDABLE` | conversa sem conexão WhatsApp | não repetir; sinalizar ao usuário |
| 502 | `SEND_FAILED` | falha no canal WhatsApp | repetir com o **mesmo** `clientMessageId` |
| 500 | `INTERNAL_ERROR` | erro interno inesperado | repetir com backoff; reportar se persistir |

Observação: erros 4xx/5xx sempre seguem o envelope `{"error":{"code","message"}}`; alguns `VALIDATION_ERROR` podem incluir `details`.

## 10. Resumo do contrato de resiliência

1. **Envio**: sempre com `clientMessageId` próprio e estável por tentativa de envio; retry seguro.
2. **Leitura**: paginação por cursor opaco (`nextCursor`); nunca montar cursors manualmente.
3. **Tempo real**: SSE com cursor persistido; ao receber `resync`, re-sincronizar via REST e retomar do `latestSeq`.
4. **Segurança**: token só no BFF; revogação imediata em caso de suspeita; lembrar que tudo é auditado (sem conteúdo).
