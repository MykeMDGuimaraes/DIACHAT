const idempotencyHeader = {
  in: "header",
  name: "Idempotency-Key",
  required: true,
  schema: { type: "string", minLength: 8, maxLength: 128 }
} as const;

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
  headers: {
    "Idempotent-Replayed": {
      schema: { type: "boolean" },
      description: "true quando a resposta original foi reproduzida"
    }
  },
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
    version: "1.2.0",
    description:
      "Contrato público durável e idempotente do DIA CHAT para integrações de mensageria e automação."
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
          type: { type: "string", enum: ["text", "buttons"] },
          text: { type: "string", minLength: 1 },
          buttons: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { $ref: "#/components/schemas/Button" }
          },
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
              "REQUEST_IN_PROGRESS",
              "IDEMPOTENCY_CONFLICT",
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
        parameters: [idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MessageRequest" }
            }
          }
        },
        responses: {
          "200": acceptedResponse,
          "202": acceptedResponse,
          "409": {
            description:
              "REQUEST_IN_PROGRESS, IDEMPOTENCY_CONFLICT ou STALE_AUTOMATION_EPOCH"
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
        parameters: [conversationIdParameter, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/HandoffRequest" }
            }
          }
        },
        responses: {
          "200": acceptedResponse,
          "202": acceptedResponse,
          "409": { description: "Conflito" }
        }
      }
    },
    "/api/v1/conversations/{conversationId}/finalize": {
      post: {
        summary: "Finaliza sem pesquisa ou mensagem nativa",
        security: apiSecurity,
        parameters: [conversationIdParameter, idempotencyHeader],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/FinalizeRequest" }
            }
          }
        },
        responses: {
          "200": acceptedResponse,
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
    }
  },
  "x-api-scopes": [
    "messages:write",
    "conversations:write",
    "integration:read",
    "transcript:read"
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

export default messagingOpenApi;
