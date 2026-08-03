const conversationIdParameter = {
  name: "conversationId",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" }
} as const;

const apiSecurity = [{ ApiKey: [] }] as const;
const sessionSecurity = [{ Session: [] }] as const;

const acceptedResponse = {
  description: "Comando aceito e persistido antes da resposta",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/AcceptedCommand" }
    }
  }
} as const;

export const messagingOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "DIA CHAT Messaging API",
    version: "1.3.0",
    description:
      "Contrato público durável do DIA CHAT para integrações de mensageria e automação."
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      ApiKey: { type: "http", scheme: "bearer", bearerFormat: "dch_live_*" },
      Session: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
    },
    schemas: {
      Button: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title"],
        properties: {
          id: {
            type: "string",
            minLength: 1,
            maxLength: 256,
            description:
              "Identificador opaco preservado byte a byte, inclusive :, _ e -."
          },
          title: { type: "string", minLength: 1, maxLength: 20 }
        }
      },
      MessageRequest: {
        type: "object",
        additionalProperties: false,
        required: [
          "connectionId",
          "to",
          "type",
          "externalTicketId",
          "automationEpoch"
        ],
        properties: {
          connectionId: { type: "integer", minimum: 1 },
          to: { type: "string", pattern: "^\\d{10,15}$" },
          type: { type: "string", enum: ["text", "buttons", "image", "audio", "video", "document", "template"] },
          text: { type: "string", minLength: 1 },
          buttons: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { $ref: "#/components/schemas/Button" }
          },
          media: { type: "object", description: "URL HTTPS da mídia; alternativamente envie multipart/form-data com o campo media." },
          internalTemplateId: { type: "string", format: "uuid" },
          variables: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
          externalTicketId: { type: "string", minLength: 1 },
          automationEpoch: { type: "integer", minimum: 0 }
        }
      },
      HandoffRequest: {
        type: "object",
        additionalProperties: false,
        required: ["action", "queueId", "externalTicketId", "automationEpoch"],
        properties: {
          action: {
            type: "string",
            enum: ["pause_automation", "takeover", "release_automation"]
          },
          queueId: { type: "integer", minimum: 1 },
          userId: { type: "integer", minimum: 1 },
          externalTicketId: { type: "string", minLength: 1 },
          automationEpoch: { type: "integer", minimum: 0 }
        }
      },
      FinalizeRequest: {
        type: "object",
        additionalProperties: false,
        required: ["sendNativeSurvey", "externalTicketId", "automationEpoch"],
        properties: {
          sendNativeSurvey: { type: "boolean", const: false },
          externalTicketId: { type: "string", minLength: 1 },
          automationEpoch: { type: "integer", minimum: 0 }
        }
      },
      AcceptedCommand: {
        type: "object",
        required: ["id", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          status: { type: "string", const: "accepted" },
          messageId: { type: "string" },
          conversationId: { type: "string", format: "uuid" },
          contactId: { type: "string" }
        }
      },
      IntegrationReady: {
        type: "object",
        required: ["ready", "connection", "queues", "capabilities"],
        properties: {
          ready: { type: "boolean" },
          connection: { type: "object" },
          queues: { type: "array", items: { type: "object" } },
          capabilities: {
            type: "object",
            required: ["buttons"],
            properties: { buttons: { type: "boolean" } }
          },
          failures: { type: "array", items: { type: "string" } }
        }
      },
      TranscriptPage: {
        type: "object",
        required: ["items"],
        properties: {
          items: { type: "array", items: { type: "object" } },
          nextCursor: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorProvider: {
        type: "object",
        additionalProperties: false,
        required: ["name", "eventId", "messageId", "timestamp"],
        properties: {
          name: { type: ["string", "null"] },
          eventId: { type: ["string", "null"] },
          messageId: { type: ["string", "null"] },
          timestamp: { type: ["string", "null"], format: "date-time" }
        }
      },
      WhatsAppMirrorConnection: {
        type: "object",
        additionalProperties: false,
        required: ["id", "publicId", "state", "phoneNumber"],
        properties: {
          id: { type: ["integer", "null"] },
          publicId: { type: ["string", "null"] },
          state: { type: ["string", "null"] },
          phoneNumber: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorContact: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "jid",
          "lid",
          "phoneNumber",
          "name",
          "pushName",
          "isBusiness"
        ],
        properties: {
          id: { type: ["string", "null"] },
          jid: { type: ["string", "null"] },
          lid: { type: ["string", "null"] },
          phoneNumber: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          pushName: { type: ["string", "null"] },
          isBusiness: { type: ["boolean", "null"] }
        }
      },
      WhatsAppMirrorConversation: {
        type: "object",
        additionalProperties: false,
        required: ["id", "externalTicketId", "automationEpoch", "status"],
        properties: {
          id: { type: ["string", "null"] },
          externalTicketId: { type: ["string", "null"] },
          automationEpoch: { type: ["integer", "null"], minimum: 0 },
          status: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorChat: {
        type: "object",
        additionalProperties: false,
        required: [
          "jid",
          "lid",
          "type",
          "name",
          "archived",
          "pinned",
          "mutedUntil",
          "unreadCount"
        ],
        properties: {
          jid: { type: ["string", "null"] },
          lid: { type: ["string", "null"] },
          type: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          archived: { type: ["boolean", "null"] },
          pinned: { type: ["boolean", "null"] },
          mutedUntil: { type: ["string", "null"], format: "date-time" },
          unreadCount: { type: ["integer", "null"], minimum: 0 }
        }
      },
      WhatsAppMirrorQuotedMessage: {
        type: "object",
        additionalProperties: false,
        required: ["id", "providerMessageId", "participant", "type", "text"],
        properties: {
          id: { type: ["string", "null"] },
          providerMessageId: { type: ["string", "null"] },
          participant: { type: ["string", "null"] },
          type: { type: ["string", "null"] },
          text: {
            type: ["string", "null"],
            "x-maxUtf8Bytes": 4096
          }
        }
      },
      WhatsAppMirrorReaction: {
        type: "object",
        additionalProperties: false,
        required: ["emoji", "targetMessageId", "removed"],
        properties: {
          emoji: { type: ["string", "null"] },
          targetMessageId: { type: ["string", "null"] },
          removed: { type: ["boolean", "null"] }
        }
      },
      WhatsAppMirrorInteractive: {
        type: "object",
        additionalProperties: false,
        required: ["type", "id", "title", "description"],
        properties: {
          type: { type: ["string", "null"] },
          id: { type: ["string", "null"] },
          title: { type: ["string", "null"] },
          description: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorMedia: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "mimeType",
          "fileName",
          "sizeBytes",
          "sha256",
          "url",
          "available",
          "caption"
        ],
        properties: {
          type: { type: ["string", "null"] },
          mimeType: { type: ["string", "null"] },
          fileName: { type: ["string", "null"] },
          sizeBytes: { type: ["integer", "null"], minimum: 0 },
          sha256: { type: ["string", "null"] },
          url: { type: ["string", "null"] },
          available: { type: ["boolean", "null"] },
          caption: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorLocation: {
        type: "object",
        additionalProperties: false,
        required: ["latitude", "longitude", "name", "address", "url"],
        properties: {
          latitude: { type: ["number", "null"], minimum: -90, maximum: 90 },
          longitude: {
            type: ["number", "null"],
            minimum: -180,
            maximum: 180
          },
          name: { type: ["string", "null"] },
          address: { type: ["string", "null"] },
          url: { type: ["string", "null"] }
        }
      },
      WhatsAppMirrorSharedContact: {
        type: "object",
        additionalProperties: false,
        required: ["displayName", "vcard", "phoneNumbers"],
        properties: {
          displayName: { type: ["string", "null"] },
          vcard: { type: ["string", "null"] },
          phoneNumbers: {
            type: ["array", "null"],
            items: { type: ["string", "null"] }
          }
        }
      },
      WhatsAppMirrorPoll: {
        type: "object",
        additionalProperties: false,
        required: ["name", "options", "selectedOptionIds", "multipleAnswers"],
        properties: {
          name: { type: ["string", "null"] },
          options: {
            type: ["array", "null"],
            items: { type: ["string", "null"] }
          },
          selectedOptionIds: {
            type: ["array", "null"],
            items: { type: ["string", "null"] }
          },
          multipleAnswers: { type: ["boolean", "null"] }
        }
      },
      WhatsAppMirrorEdit: {
        type: "object",
        additionalProperties: false,
        required: ["targetMessageId", "text", "editedAt"],
        properties: {
          targetMessageId: { type: ["string", "null"] },
          text: { type: ["string", "null"] },
          editedAt: { type: ["string", "null"], format: "date-time" }
        }
      },
      WhatsAppMirrorDelete: {
        type: "object",
        additionalProperties: false,
        required: ["targetMessageId", "deletedAt", "forEveryone"],
        properties: {
          targetMessageId: { type: ["string", "null"] },
          deletedAt: { type: ["string", "null"], format: "date-time" },
          forEveryone: { type: ["boolean", "null"] }
        }
      },
      WhatsAppMirrorMessage: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "providerMessageId",
          "direction",
          "fromMe",
          "type",
          "text",
          "timestamp",
          "status",
          "quoted",
          "reaction",
          "interactive",
          "media",
          "location",
          "contacts",
          "poll",
          "edit",
          "delete"
        ],
        properties: {
          id: { type: ["string", "null"] },
          providerMessageId: { type: ["string", "null"] },
          direction: { type: ["string", "null"] },
          fromMe: { type: ["boolean", "null"] },
          type: { type: ["string", "null"] },
          text: {
            type: ["string", "null"],
            "x-maxUtf8Bytes": 65536
          },
          timestamp: { type: ["string", "null"], format: "date-time" },
          status: { type: ["string", "null"] },
          quoted: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorQuotedMessage" },
              { type: "null" }
            ]
          },
          reaction: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorReaction" },
              { type: "null" }
            ]
          },
          interactive: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorInteractive" },
              { type: "null" }
            ]
          },
          media: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorMedia" },
              { type: "null" }
            ]
          },
          location: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorLocation" },
              { type: "null" }
            ]
          },
          contacts: {
            type: ["array", "null"],
            items: {
              $ref: "#/components/schemas/WhatsAppMirrorSharedContact"
            }
          },
          poll: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorPoll" },
              { type: "null" }
            ]
          },
          edit: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorEdit" },
              { type: "null" }
            ]
          },
          delete: {
            anyOf: [
              { $ref: "#/components/schemas/WhatsAppMirrorDelete" },
              { type: "null" }
            ]
          }
        }
      },
      LegacyWebhookEnvelope: {
        type: "object",
        not: { required: ["schema"] },
        description:
          "Envelope 1.1 emitido quando MESSAGING_WEBHOOK_MIRROR_V1_ENABLED=false; o campo schema nÃ£o Ã© exigido.",
        required: ["id", "type", "createdAt", "data"],
        properties: {
          id: { type: "string" },
          type: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          data: { type: "object", additionalProperties: true }
        }
      },
      WhatsAppMirrorEnvelope: {
        type: "object",
        additionalProperties: false,
        "x-maxCanonicalBytes": 262144,
        "x-canonicalSerialization": "recursive-key-sort-json-utf8",
        "x-digest": "SHA-256",
        "x-eventIdentity": "UUIDv5",
        required: ["schema", "id", "type", "createdAt", "data"],
        properties: {
          schema: { type: "string", const: "whatsapp-mirror/1" },
          id: { type: "string", format: "uuid" },
          type: { type: "string", minLength: 1 },
          createdAt: { type: "string", format: "date-time" },
          data: {
            type: "object",
            additionalProperties: false,
            required: [
              "messageId",
              "whatsappId",
              "conversationId",
              "contactId",
              "externalTicketId",
              "automationEpoch",
              "actorType",
              "kind",
              "origin",
              "provider",
              "connection",
              "contact",
              "conversation",
              "chat",
              "message",
              "truncated"
            ],
            properties: {
              messageId: { type: ["string", "null"] },
              whatsappId: { type: ["integer", "null"] },
              conversationId: { type: ["string", "null"] },
              contactId: { type: ["string", "null"] },
              externalTicketId: { type: ["string", "null"] },
              automationEpoch: { type: ["integer", "null"], minimum: 0 },
              actorType: { type: ["string", "null"] },
              kind: { type: ["string", "null"] },
              origin: { type: ["string", "null"] },
              provider: {
                $ref: "#/components/schemas/WhatsAppMirrorProvider"
              },
              connection: {
                $ref: "#/components/schemas/WhatsAppMirrorConnection"
              },
              contact: {
                $ref: "#/components/schemas/WhatsAppMirrorContact"
              },
              conversation: {
                $ref: "#/components/schemas/WhatsAppMirrorConversation"
              },
              chat: { $ref: "#/components/schemas/WhatsAppMirrorChat" },
              message: {
                $ref: "#/components/schemas/WhatsAppMirrorMessage"
              },
              truncated: { type: "boolean" }
            }
          }
        }
      },
      WhatsAppMirrorSerializedSnapshot: {
        type: "object",
        additionalProperties: false,
        description:
          "Resultado interno da projeção para persistência/entrega. rawBody é o envelope canônico serializado; bodySha256 não integra o rawBody nem o corpo enviado ao consumidor.",
        required: ["envelope", "rawBody", "bodySha256"],
        properties: {
          envelope: {
            $ref: "#/components/schemas/WhatsAppMirrorEnvelope"
          },
          rawBody: {
            type: "string",
            contentMediaType: "application/json",
            description:
              "JSON canônico do envelope em UTF-8, exatamente como assinado e entregue."
          },
          bodySha256: {
            type: "string",
            pattern: "^[0-9a-f]{64}$",
            description:
              "SHA-256 hexadecimal minúsculo dos bytes UTF-8 exatos de rawBody."
          }
        }
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            enum: [
              "STALE_AUTOMATION_EPOCH",
              "CAPABILITY_NOT_SUPPORTED"
            ]
          },
          message: { type: "string" }
        }
      }
    }
  },
  paths: {
    "/api/v1/openapi.json": {
      get: {
        summary: "Retorna este contrato após autenticação",
        security: apiSecurity,
        responses: { "200": { description: "OpenAPI 3.1" } }
      }
    },
    "/api/v1/messages": {
      post: {
        summary: "Aceita mensagem de texto ou botões nativos",
        security: apiSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MessageRequest" }
            },
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["connectionId", "to", "type", "media"],
                properties: {
                  connectionId: { type: "integer", minimum: 1 },
                  to: { type: "string", pattern: "^\\d{10,15}$" },
                  type: { type: "string", enum: ["image", "audio", "video", "document"] },
                  media: { type: "string", format: "binary" },
                  caption: { type: "string" },
                  externalTicketId: { type: "string" },
                  automationEpoch: { type: "integer", minimum: 0 }
                }
              }
            }
          }
        },
        responses: {
          "202": acceptedResponse,
          "409": {
            description: "STALE_AUTOMATION_EPOCH"
          },
          "422": { description: "CAPABILITY_NOT_SUPPORTED" },
          "429": { description: "Limite configurável excedido" }
        }
      }
    },
    "/api/v1/conversations/{conversationId}/handoff": {
      post: {
        summary: "Pausa, assume ou libera explicitamente a automação",
        security: apiSecurity,
        parameters: [conversationIdParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HandoffRequest" }
            }
          }
        },
        responses: {
          "202": acceptedResponse,
          "409": { description: "Conflito" }
        }
      }
    },
    "/api/v1/conversations/{conversationId}/finalize": {
      post: {
        summary: "Finaliza sem pesquisa ou mensagem nativa",
        security: apiSecurity,
        parameters: [conversationIdParameter],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FinalizeRequest" }
            }
          }
        },
        responses: {
          "202": acceptedResponse,
          "409": { description: "Conflito" }
        }
      }
    },
    "/api/v1/integration/ready": {
      get: {
        summary: "Valida conexão, filas e suporte a botões com recursos reais",
        security: apiSecurity,
        parameters: [
          {
            name: "connectionId",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1 }
          },
          {
            name: "automationQueueId",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1 }
          },
          {
            name: "humanQueueId",
            in: "query",
            required: true,
            schema: { type: "integer", minimum: 1 }
          }
        ],
        responses: {
          "200": {
            description: "Estado de prontidão",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/IntegrationReady" }
              }
            }
          }
        }
      }
    },
    "/api/v1/conversations/{conversationId}/messages": {
      get: {
        summary: "Transcript paginado da conversa",
        security: apiSecurity,
        parameters: [
          conversationIdParameter,
          {
            name: "cursor",
            in: "query",
            schema: { type: "string" }
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 }
          }
        ],
        responses: {
          "200": {
            description: "Página do transcript",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TranscriptPage" }
              }
            }
          }
        }
      }
    },
    "/api/v1/credentials": {
      get: {
        summary: "Lista credenciais sem segredos",
        security: sessionSecurity,
        responses: { "200": { description: "Credenciais" } }
      },
      post: {
        summary: "Emite credencial com segredo exibido uma única vez",
        security: sessionSecurity,
        responses: { "201": { description: "Credencial emitida" } }
      }
    },
    "/api/v1/webhook-subscriptions": {
      get: {
        summary: "Lista assinaturas",
        security: sessionSecurity,
        responses: { "200": { description: "Assinaturas" } }
      },
      post: {
        summary: "Cria assinatura com segredo de exibição única",
        security: sessionSecurity,
        responses: { "201": { description: "Assinatura criada" } }
      }
    },
    "/api/v1/presence": {
      post: {
        summary: "Atualiza presenca Baileys (efemera)", "x-phase": "1", "x-status": "available", security: apiSecurity,
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["connectionId", "to", "state"], properties: { connectionId: { type: "integer" }, to: { type: "string" }, state: { type: "string", enum: ["available", "unavailable", "composing", "recording", "paused"] }, duration: { type: "integer", maximum: 60 } } } } } },
        responses: { "204": { description: "Presenca aceita sem persistencia ou retry" }, "422": { description: "Capability nao suportada" } }
      }
    },
    "/api/v1/messages/{messageId}/reactions": {
      post: { summary: "Envia reacao Baileys", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { "202": acceptedResponse } },
      delete: { summary: "Remove reacao Baileys", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { "202": acceptedResponse } }
    },
    "/api/v1/messages/{messageId}": {
      patch: { summary: "Edita mensagem Baileys", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { "202": acceptedResponse } },
      delete: { summary: "Exclui mensagem Baileys", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [{ name: "messageId", in: "path", required: true, schema: { type: "string" } }], responses: { "202": acceptedResponse } }
    },
    "/api/v1/messages/{messageId}/media": {
      get: {
        summary: "Obtém mídia como URL assinada, download ou Base64",
        description: "format=url retorna metadados e URL assinada (padrão); format=download transmite o arquivo; format=base64 retorna a mídia em JSON. includeBase64=true pode acrescentar Base64 à resposta do formato url.",
        "x-phase": "1",
        "x-status": "available",
        security: apiSecurity,
        parameters: [
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
          { name: "format", in: "query", required: false, schema: { type: "string", enum: ["url", "download", "base64"], default: "url" } },
          { name: "includeBase64", in: "query", required: false, description: "Acrescenta Base64 ao JSON de format=url. Não pode ser usado com format=download.", schema: { type: "boolean", default: false } }
        ],
        responses: {
          "200": {
            description: "Metadados JSON ou conteúdo binário, conforme format",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["messageId", "mediaType", "mimeType", "fileName", "sizeBytes", "sha256", "available", "url", "downloadUrl", "expiresAt"],
                  properties: {
                    messageId: { type: "string" },
                    mediaType: { type: ["string", "null"] },
                    mimeType: { type: ["string", "null"] },
                    fileName: { type: "string" },
                    sizeBytes: { type: "integer", minimum: 0 },
                    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
                    available: { type: "boolean", const: true },
                    url: { type: ["string", "null"], description: "Alias retrocompatível de downloadUrl." },
                    downloadUrl: { type: ["string", "null"] },
                    expiresAt: { type: ["string", "null"], format: "date-time" },
                    encoding: { type: "string", const: "base64" },
                    base64: { type: "string", contentEncoding: "base64" }
                  }
                }
              },
              "application/octet-stream": { schema: { type: "string", format: "binary" } }
            }
          },
          "400": { description: "Formato ou combinação de parâmetros inválida" },
          "404": { description: "Mídia não encontrada ou fora das conexões autorizadas" },
          "413": { description: "Arquivo excede MESSAGING_MEDIA_BASE64_MAX_BYTES para retorno Base64" }
        }
      }
    },
    "/api/v1/conversations": {
      get: { summary: "Lista conversas espelhadas", "x-phase": "1", "x-status": "available", security: apiSecurity, responses: { "200": { description: "Pagina de conversas" } } }
    },
    "/api/v1/conversations/{conversationId}": {
      get: { summary: "Consulta conversa espelhada", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [conversationIdParameter], responses: { "200": { description: "Conversa" } } }
    },
    "/api/v1/message-templates/{templateId}/render": {
      post: { summary: "Renderiza internalTemplate sem enviar", "x-phase": "1", "x-status": "available", security: apiSecurity, parameters: [{ name: "templateId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Template renderizado" } } }
    }
  },
  "x-api-scopes": [
    "messages:write",
    "conversations:write",
    "integration:read",
    "transcript:read",
    "conversations:read",
    "presence:write",
    "reactions:write",
    "messages:manage",
    "media:read",
    "templates:write"
  ],
  "x-webhook-events": {
    payloadSchema: {
      oneOf: [
        { $ref: "#/components/schemas/LegacyWebhookEnvelope" },
        { $ref: "#/components/schemas/WhatsAppMirrorEnvelope" }
      ],
      "x-feature-flag": "MESSAGING_WEBHOOK_MIRROR_V1_ENABLED",
      description:
        "Flag desligada: legado 1.1 sem schema obrigatÃ³rio. Flag ligada: mirror 1.2 com schema=whatsapp-mirror/1."
    },
    events: [
      "button.clicked",
      "message.received",
      "message.reaction",
      "message.edited",
      "message.deleted",
      "chat.updated",
      "connection.updated",
      "message.sent",
      "message.failed",
      "message.status.updated",
      "handoff.paused",
      "handoff.released",
      "conversation.created",
      "conversation.updated"
    ]
  },
  "x-whatsapp-mirror-projection": {
    envelopeSchema: "#/components/schemas/WhatsAppMirrorEnvelope",
    serializedSnapshotSchema:
      "#/components/schemas/WhatsAppMirrorSerializedSnapshot",
    digestScope: "SHA-256 dos bytes UTF-8 exatos de rawBody"
  },
  "x-webhook-signature": {
    algorithm: "HMAC-SHA256",
    signedContent: "<timestamp>.<raw_body>",
    headers: ["X-DiaChat-Timestamp", "X-DiaChat-Signature"],
    toleranceSeconds: 300,
    deliverySemantics: "at-least-once"
  }
} as const;

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } }
});

const commonPublicErrors = {
  "400": errorResponse("Payload, header ou parâmetro inválido"),
  "401": errorResponse("Credencial Bearer ausente, inválida ou revogada"),
  "403": errorResponse("Scope ou conexão não autorizada"),
  "404": errorResponse("Recurso não encontrado ou funcionalidade desabilitada"),
  "409": errorResponse("Conflito de idempotência, estado ou concorrência"),
  "422": errorResponse("Capability não suportada pelo canal"),
  "429": errorResponse("Limite de requisições excedido")
};
const commonAdminErrors = {
  "400": errorResponse("Payload ou parâmetro inválido"),
  "401": errorResponse("Sessão ausente ou expirada"),
  "403": errorResponse("Perfil administrativo obrigatório"),
  "404": errorResponse("Recurso não encontrado")
};
const jsonBody = (schema: Record<string, unknown>) => ({
  required: true,
  content: { "application/json": { schema } }
});
const publicOperation = (
  operation: Record<string, any>,
  scope: string,
  additions: Record<string, any> = {}
) => ({
  ...operation,
  ...additions,
  "x-required-scope": scope,
  responses: { ...commonPublicErrors, ...(operation.responses || {}), ...(additions.responses || {}) }
});
const adminOperation = (
  operation: Record<string, any>,
  additions: Record<string, any> = {}
) => ({
  ...operation,
  ...additions,
  responses: { ...commonAdminErrors, ...(operation.responses || {}), ...(additions.responses || {}) }
});
const templateIdParameter = { name: "templateId", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const optionalQuery = (name: string, schema: Record<string, unknown> = { type: "string" }) => ({ name, in: "query", required: false, schema });

const documentedPaths: Record<string, any> = {
  ...messagingOpenApi.paths,
  "/api/v1/admin/openapi.json": {
    get: adminOperation({ summary: "Retorna o contrato administrativo", security: sessionSecurity, responses: { "200": { description: "OpenAPI administrativo 3.1" } } })
  },
  "/api/v1/openapi.json": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/openapi.json"].get, "integration:read")
  },
  "/api/v1/messages": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/messages"].post, "messages:write")
  },
  "/api/v1/integration/ready": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/integration/ready"].get, "integration:read")
  },
  "/api/v1/conversations/{conversationId}/handoff": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/conversations/{conversationId}/handoff"].post, "conversations:write")
  },
  "/api/v1/conversations/{conversationId}/finalize": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/conversations/{conversationId}/finalize"].post, "conversations:write")
  },
  "/api/v1/conversations/{conversationId}/messages": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/conversations/{conversationId}/messages"].get, "transcript:read", {
      parameters: [conversationIdParameter, optionalQuery("cursor"), optionalQuery("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 }), optionalQuery("from", { type: "string", format: "date-time" }), optionalQuery("to", { type: "string", format: "date-time" }), optionalQuery("type"), optionalQuery("fromMe", { type: "boolean" }), optionalQuery("mediaOnly", { type: "boolean" }), optionalQuery("status", { type: "string", enum: ["accepted", "sent", "delivered", "read", "failed", "received"] }), optionalQuery("providerMessageId")]
    })
  },
  "/api/v1/presence": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/presence"].post, "presence:write", { "x-feature-flag": "MESSAGING_PRESENCE_V1_ENABLED" })
  },
  "/api/v1/messages/{messageId}/reactions": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/messages/{messageId}/reactions"].post, "reactions:write", { "x-feature-flag": "MESSAGING_REACTIONS_V1_ENABLED", requestBody: jsonBody({ type: "object", additionalProperties: false, required: ["emoji"], properties: { emoji: { type: "string", minLength: 1, maxLength: 32 } } }) }),
    delete: publicOperation(messagingOpenApi.paths["/api/v1/messages/{messageId}/reactions"].delete, "reactions:write", { "x-feature-flag": "MESSAGING_REACTIONS_V1_ENABLED" })
  },
  "/api/v1/messages/{messageId}": {
    patch: publicOperation(messagingOpenApi.paths["/api/v1/messages/{messageId}"].patch, "messages:manage", { "x-feature-flag": "MESSAGING_REACTIONS_V1_ENABLED", requestBody: jsonBody({ type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string", minLength: 1 } } }) }),
    delete: publicOperation(messagingOpenApi.paths["/api/v1/messages/{messageId}"].delete, "messages:manage", { "x-feature-flag": "MESSAGING_REACTIONS_V1_ENABLED" })
  },
  "/api/v1/messages/{messageId}/media": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/messages/{messageId}/media"].get, "media:read")
  },
  "/api/v1/conversations": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/conversations"].get, "conversations:read", { parameters: [optionalQuery("connectionId", { type: "integer", minimum: 1 }), optionalQuery("cursor"), optionalQuery("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 })] })
  },
  "/api/v1/conversations/{conversationId}": {
    get: publicOperation(messagingOpenApi.paths["/api/v1/conversations/{conversationId}"].get, "conversations:read")
  },
  "/api/v1/message-templates/{templateId}/render": {
    post: publicOperation(messagingOpenApi.paths["/api/v1/message-templates/{templateId}/render"].post, "templates:write", { "x-feature-flag": "MESSAGING_INTERNAL_TEMPLATES_V1_ENABLED", requestBody: jsonBody({ type: "object", additionalProperties: false, properties: { variables: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } } } }) })
  },
  "/api/v1/credentials": {
    get: adminOperation(messagingOpenApi.paths["/api/v1/credentials"].get),
    post: adminOperation(messagingOpenApi.paths["/api/v1/credentials"].post, { requestBody: jsonBody({ type: "object", additionalProperties: false, required: ["name", "scopes", "connectionIds"], properties: { name: { type: "string", minLength: 1 }, scopes: { type: "array", items: { type: "string", enum: messagingOpenApi["x-api-scopes"] } }, connectionIds: { type: "array", items: { type: "integer", minimum: 1 } } } }) })
  },
  "/api/v1/credentials/{credentialId}": {
    delete: adminOperation({ summary: "Revoga uma credencial pública", security: sessionSecurity, parameters: [{ name: "credentialId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "204": { description: "Credencial revogada" } } })
  },
  "/api/v1/webhook-subscriptions": {
    get: adminOperation(messagingOpenApi.paths["/api/v1/webhook-subscriptions"].get),
    post: adminOperation(messagingOpenApi.paths["/api/v1/webhook-subscriptions"].post, { requestBody: jsonBody({ type: "object", required: ["name", "url", "events"], properties: { name: { type: "string" }, url: { type: "string", format: "uri" }, method: { type: "string", enum: ["POST", "PUT", "PATCH"] }, events: { type: "array", items: { type: "string" } }, connectionIds: { type: "array", items: { type: "integer", minimum: 1 } }, messageKinds: { type: "array", items: { type: "string" } }, includeApiOrigin: { type: "boolean", default: false }, excludeFilters: { type: "array", uniqueItems: true, items: { type: "string", enum: ["fromMe", "group", "apiOriginated"] } }, enabled: { type: "boolean", default: true } }, additionalProperties: false }) })
  },
  "/api/v1/webhook-subscriptions/{subscriptionId}": {
    put: adminOperation({ summary: "Atualiza e opcionalmente rotaciona uma assinatura", security: sessionSecurity, parameters: [{ name: "subscriptionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: jsonBody({ type: "object", properties: { name: { type: "string" }, url: { type: "string", format: "uri" }, method: { type: "string", enum: ["POST", "PUT", "PATCH"] }, events: { type: "array", items: { type: "string" } }, connectionIds: { type: "array", items: { type: "integer", minimum: 1 } }, messageKinds: { type: "array", items: { type: "string" } }, includeApiOrigin: { type: "boolean" }, excludeFilters: { type: "array", uniqueItems: true, items: { type: "string", enum: ["fromMe", "group", "apiOriginated"] } }, enabled: { type: "boolean" }, rotateSecret: { type: "boolean" } }, additionalProperties: false }), responses: { "200": { description: "Assinatura atualizada" } } }),
    delete: adminOperation({ summary: "Exclui uma assinatura", security: sessionSecurity, parameters: [{ name: "subscriptionId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "204": { description: "Assinatura excluída" } } })
  },
  "/api/v1/webhook-deliveries": {
    get: adminOperation({ summary: "Lista entregas sem corpo ou PII", security: sessionSecurity, parameters: [optionalQuery("subscriptionId"), optionalQuery("status")], responses: { "200": { description: "Entregas" } } })
  },
  "/api/v1/webhook-deliveries/{deliveryId}/retry": {
    post: adminOperation({ summary: "Reagenda uma dead-letter ainda retida", security: sessionSecurity, parameters: [{ name: "deliveryId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "202": { description: "Retry aceito" }, "409": errorResponse("Entrega não está em dead-letter"), "410": errorResponse("Snapshot expirado ou purgado") } })
  },
  "/api/v1/message-templates": {
    get: adminOperation({ summary: "Lista templates internos", security: sessionSecurity, responses: { "200": { description: "Templates" } } }),
    post: adminOperation({ summary: "Cria template interno", security: sessionSecurity, requestBody: jsonBody({ type: "object", required: ["name", "content"], properties: { name: { type: "string" }, content: { type: "string" }, variables: { type: "array", items: { type: "string" } }, active: { type: "boolean" } } }), responses: { "201": { description: "Template criado" } } })
  },
  "/api/v1/message-templates/{templateId}": {
    put: adminOperation({ summary: "Atualiza template interno", security: sessionSecurity, parameters: [templateIdParameter], requestBody: jsonBody({ type: "object", additionalProperties: false, properties: { name: { type: "string" }, content: { type: "string" }, variables: { type: "array", items: { type: "string" } }, active: { type: "boolean" } } }), responses: { "200": { description: "Template atualizado" } } }),
    delete: adminOperation({ summary: "Exclui template interno", security: sessionSecurity, parameters: [templateIdParameter], responses: { "204": { description: "Template excluído" } } })
  },
  "/api/v1/channels/meta-cloud": {
    get: adminOperation({ summary: "Lista canais Meta Cloud", security: sessionSecurity, "x-feature-flag": "MESSAGING_META_CLOUD_ENABLED", responses: { "200": { description: "Canais oficiais" } } }),
    post: adminOperation({ summary: "Cria canal Meta Cloud", security: sessionSecurity, "x-feature-flag": "MESSAGING_META_CLOUD_ENABLED", requestBody: jsonBody({ type: "object", additionalProperties: true }), responses: { "201": { description: "Canal criado" } } })
  },
  "/api/v1/channels/meta-cloud/{whatsappId}/credentials": {
    put: adminOperation({ summary: "Rotaciona credenciais Meta Cloud", security: sessionSecurity, "x-feature-flag": "MESSAGING_META_CLOUD_ENABLED", parameters: [{ name: "whatsappId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }], requestBody: jsonBody({ type: "object", additionalProperties: true }), responses: { "200": { description: "Credenciais rotacionadas" } } })
  },
  "/api/v1/channels/meta-cloud/{whatsappId}": {
    delete: adminOperation({ summary: "Revoga canal Meta Cloud", security: sessionSecurity, "x-feature-flag": "MESSAGING_META_CLOUD_ENABLED", parameters: [{ name: "whatsappId", in: "path", required: true, schema: { type: "integer", minimum: 1 } }], responses: { "204": { description: "Canal revogado" } } })
  }
};

export const messagingCompleteOpenApi = { ...messagingOpenApi, paths: documentedPaths };

const filterBySecurity = (scheme: "ApiKey" | "Session") => Object.fromEntries(
  Object.entries(documentedPaths).map(([path, operations]) => [path, Object.fromEntries(
    Object.entries(operations as Record<string, any>).filter(([, operation]) =>
      Array.isArray(operation?.security) && operation.security.some((entry: Record<string, unknown>) => Object.prototype.hasOwnProperty.call(entry, scheme))
    )
  )]).filter(([, operations]) => Object.keys(operations).length > 0)
);

export const messagingPublicOpenApi = { ...messagingCompleteOpenApi, paths: filterBySecurity("ApiKey") };
export const messagingAdminOpenApi = {
  ...messagingCompleteOpenApi,
  info: { ...messagingCompleteOpenApi.info, title: "DIA CHAT Messaging Administration API" },
  paths: filterBySecurity("Session")
};

export default messagingCompleteOpenApi;
