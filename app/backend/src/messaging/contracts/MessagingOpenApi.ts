const messageRequest = {
  type: "object",
  required: ["connectionId", "to", "type"],
  properties: {
    connectionId: { type: "integer" },
    to: { type: "string", pattern: "^\\d{10,15}$" },
    type: {
      type: "string",
      enum: ["text", "image", "audio", "video", "document", "template"]
    },
    text: { type: "string" },
    media: {
      type: "object",
      properties: {
        link: { type: "string", format: "uri", pattern: "^https://" },
        caption: { type: "string" },
        filename: { type: "string" }
      }
    },
    template: {
      type: "object",
      properties: {
        name: { type: "string" },
        language: { type: "string" },
        components: { type: "array", items: { type: "object" } }
      }
    }
  }
};

export const messagingOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "DiaChat Messaging API",
    version: "1.0.0",
    description:
      "API idempotente de mensageria e administração de canais/webhooks. Reenvie a mesma requisição com a mesma Idempotency-Key; payload diferente retorna 409."
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      ApiKey: { type: "http", scheme: "bearer", bearerFormat: "dch_live_*" },
      Session: { type: "http", scheme: "bearer", bearerFormat: "JWT" }
    },
    schemas: {
      MessageRequest: messageRequest,
      AcceptedMessage: {
        type: "object",
        required: ["id", "messageId", "status"],
        properties: {
          id: { type: "string", format: "uuid" },
          messageId: { type: "string" },
          status: { type: "string", enum: ["queued"] }
        }
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" }
        }
      }
    }
  },
  paths: {
    "/credentials": {
      get: {
        summary: "Lista credenciais da empresa sem o hash do segredo",
        security: [{ Session: [] }],
        responses: { "200": { description: "Credenciais" } }
      },
      post: {
        summary: "Emite chave de exibição única",
        security: [{ Session: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "scopes", "connectionIds"],
                properties: {
                  name: { type: "string" },
                  scopes: {
                    type: "array",
                    items: { type: "string", enum: ["messages:write"] }
                  },
                  connectionIds: {
                    type: "array",
                    items: { type: "integer" }
                  }
                }
              }
            }
          }
        },
        responses: { "201": { description: "Inclui apiKey uma única vez" } }
      }
    },
    "/credentials/{credentialId}": {
      delete: {
        summary: "Revoga uma credencial",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "credentialId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: { "204": { description: "Revogada" } }
      }
    },
    "/messages": {
      post: {
        summary: "Enfileira texto, mídia ou template",
        security: [{ ApiKey: [] }],
        parameters: [
          {
            in: "header",
            name: "Idempotency-Key",
            required: true,
            schema: { type: "string", minLength: 8, maxLength: 128 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/MessageRequest" }
            }
          }
        },
        responses: {
          "202": {
            description: "Comando persistido",
            headers: {
              "Idempotent-Replayed": {
                schema: { type: "boolean" },
                description: "true quando a resposta foi reproduzida"
              }
            },
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AcceptedMessage" }
              }
            }
          },
          "409": { description: "IDEMPOTENCY_CONFLICT" },
          "429": { description: "Limite por credencial/empresa excedido" }
        }
      }
    },
    "/channels/meta-cloud": {
      get: {
        summary: "Lista canais Meta sem expor segredos",
        security: [{ Session: [] }],
        responses: { "200": { description: "Canais" } }
      },
      post: {
        summary: "Valida credenciais e cria canal Meta",
        security: [{ Session: [] }],
        responses: { "201": { description: "Canal e verify token de exibição única" } }
      }
    },
    "/channels/meta-cloud/{whatsappId}/credentials": {
      put: {
        summary: "Rotaciona e valida segredos Meta",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "whatsappId",
            in: "path",
            required: true,
            schema: { type: "integer" }
          }
        ],
        responses: { "200": { description: "Credenciais rotacionadas" } }
      }
    },
    "/channels/meta-cloud/{whatsappId}": {
      delete: {
        summary: "Revoga os segredos do canal Meta",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "whatsappId",
            in: "path",
            required: true,
            schema: { type: "integer" }
          }
        ],
        responses: { "204": { description: "Canal revogado" } }
      }
    },
    "/webhook-subscriptions": {
      get: {
        summary: "Lista assinaturas",
        security: [{ Session: [] }],
        responses: { "200": { description: "Assinaturas sem segredo" } }
      },
      post: {
        summary: "Cria assinatura e retorna segredo uma única vez",
        security: [{ Session: [] }],
        responses: { "201": { description: "Assinatura criada" } }
      }
    },
    "/webhook-deliveries": {
      get: {
        summary: "Lista entregas, inclusive dead-letter",
        security: [{ Session: [] }],
        responses: { "200": { description: "Entregas" } }
      }
    },
    "/webhook-subscriptions/{subscriptionId}": {
      put: {
        summary: "Atualiza filtros, estado ou rotaciona o segredo",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "subscriptionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: { "200": { description: "Assinatura atualizada" } }
      },
      delete: {
        summary: "Remove assinatura",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "subscriptionId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: { "204": { description: "Removida" } }
      }
    },
    "/webhook-deliveries/{deliveryId}/retry": {
      post: {
        summary: "Recoloca uma entrega dead-letter na fila",
        security: [{ Session: [] }],
        parameters: [
          {
            name: "deliveryId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: { "202": { description: "Entrega pronta para nova tentativa" } }
      }
    }
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
