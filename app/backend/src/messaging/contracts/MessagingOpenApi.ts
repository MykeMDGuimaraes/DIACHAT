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
    version: "1.1.0",
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
    events: [
      "button.clicked",
      "message.received",
      "message.sent",
      "message.failed",
      "message.status.updated",
      "handoff.paused",
      "handoff.released",
      "conversation.created",
      "conversation.updated"
    ]
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
