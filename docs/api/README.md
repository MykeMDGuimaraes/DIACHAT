# DiaChat Messaging API v1

O contrato executável está disponível em `GET /api/v1/openapi.json`.

## Integração mínima

1. Um administrador emite uma credencial com escopo `messages:write` e restringe os canais permitidos.
2. O cliente envia `POST /api/v1/messages` somente com `Authorization: Bearer dch_live_...` e o corpo documentado no OpenAPI.
3. A resposta `202` significa que o comando foi persistido no PostgreSQL; não significa entrega final ao WhatsApp.
4. O cliente recebe os estados finais por webhook. A entrega é `at-least-once`, portanto o consumidor deve deduplicar pelo `event.id`. Os eventos de ciclo de vida do envio são `message.sent` (entrega confirmada pelo provedor), `message.failed` (falha terminal — erro permanente ou esgotamento das tentativas de reenvio) e `message.status.updated` com `status: "unknown"` (resultado ambíguo, por exemplo timeout após transmissão; o sistema **não** reenvia automaticamente para evitar duplicidade — decida a retomada no seu lado).
5. Verifique `X-DiaChat-Signature` calculando HMAC-SHA256 sobre `<X-DiaChat-Timestamp>.<corpo bruto>` e rejeite timestamps com diferença superior a cinco minutos.

Exemplo:

```bash
curl -X POST "$DIACHAT_URL/api/v1/messages" \
  -H "Authorization: Bearer $DIACHAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"connectionId":12,"to":"5511999999999","type":"text","text":"Olá"}'
```

Cada chamada de mutação representa uma nova operação. Aguarde a resposta `202` antes de repetir uma chamada, pois retentativas do cliente podem gerar mensagens ou alterações duplicadas.

Segredos de canal e de webhook só são exibidos na criação/rotação. Guarde-os antes de fechar a tela.

## Endpoint legado

`POST /api/messages/send` continua respondendo durante a janela de migração e envia os headers `Deprecation`, `Sunset` e `Link`. Depois do sunset configurado, ele só passa a responder `410 Gone` para uma empresa quando a auditoria comprovar 14 dias consecutivos sem uso relevante. A elegibilidade aparece em `/internal/v1/messaging/metrics`.
