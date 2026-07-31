// Ajv is already pinned by the repository toolchain and probes the emitted
// JSON Schema branches without introducing a production dependency.
// eslint-disable-next-line import/no-extraneous-dependencies
import Ajv from "ajv";
import messagingOpenApi from "../MessagingOpenApi";

const webhookBranchesMatched = (payload: Record<string, unknown>): number => {
  const ajv = new Ajv({ allErrors: true, schemaId: "auto" });
  const schemas = messagingOpenApi.components.schemas;
  return messagingOpenApi["x-webhook-events"].payloadSchema.oneOf.filter(
    branch =>
      ajv.validate(
        {
          components: { schemas },
          allOf: [branch]
        },
        payload
      )
  ).length;
};

describe("MessagingOpenApi 1.3", () => {
  it("publishes every Router P0 path as an authenticated full API path", () => {
    expect(messagingOpenApi.info.version).toBe("1.3.0");

    const requiredPaths = [
      "/api/v1/messages",
      "/api/v1/conversations/{conversationId}/handoff",
      "/api/v1/conversations/{conversationId}/finalize",
      "/api/v1/integration/ready",
      "/api/v1/openapi.json",
      "/api/v1/conversations/{conversationId}/messages"
    ] as const;

    requiredPaths.forEach(path => {
      expect(
        Object.prototype.hasOwnProperty.call(messagingOpenApi.paths, path)
      ).toBe(true);
    });

    expect(messagingOpenApi.paths["/api/v1/messages"].post.security).toEqual([
      { ApiKey: [] }
    ]);
    expect(messagingOpenApi.paths["/api/v1/openapi.json"].get.security).toEqual(
      [{ ApiKey: [] }]
    );
  });

  it("documents native buttons, correlation, epoch, scopes and stable webhook events", () => {
    const schemas = messagingOpenApi.components.schemas;
    expect(schemas.MessageRequest.properties.type.enum).toEqual(
      expect.arrayContaining(["text", "buttons", "image", "audio", "video", "document"])
    );
    expect(schemas.MessageRequest.required).toEqual(
      expect.arrayContaining([
        "connectionId",
        "to",
        "type",
        "externalTicketId",
        "automationEpoch"
      ])
    );
    expect(schemas.Button.properties.id.maxLength).toBe(256);
    expect(schemas.Button.properties.title.maxLength).toBe(20);
    expect(schemas.IntegrationReady.properties.queues).toMatchObject({
      type: "array"
    });
    [
      "/api/v1/messages",
      "/api/v1/conversations/{conversationId}/handoff",
      "/api/v1/conversations/{conversationId}/finalize"
    ].forEach(path => {
      expect(messagingOpenApi.paths[path].post.responses).toHaveProperty("200");
      expect(messagingOpenApi.paths[path].post.responses).toHaveProperty("202");
    });

    expect(messagingOpenApi["x-api-scopes"]).toEqual(
      expect.arrayContaining([
        "messages:write",
        "conversations:write",
        "integration:read",
        "transcript:read"
      ])
    );
    expect(messagingOpenApi["x-webhook-events"].events).toEqual(
      expect.arrayContaining([
        "button.clicked",
        "message.reaction",
        "message.edited",
        "message.deleted",
        "chat.updated",
        "connection.updated",
        "handoff.paused",
        "handoff.released",
        "conversation.created",
        "conversation.updated"
      ])
    );
  });

  it("documents the whatsapp-mirror/1 envelope without removing v1.1 correlation fields", () => {
    const schema = messagingOpenApi.components.schemas.WhatsAppMirrorEnvelope;

    expect(schema.properties.schema.const).toBe("whatsapp-mirror/1");
    expect(schema.required).toEqual([
      "schema",
      "id",
      "type",
      "createdAt",
      "data"
    ]);
    expect(schema.properties.data.required).toEqual(
      expect.arrayContaining([
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
      ])
    );
  });

  it("documents rich message blocks and the canonical byte safety limits", () => {
    const schemas = messagingOpenApi.components.schemas;
    const envelope = schemas.WhatsAppMirrorEnvelope;
    const message = schemas.WhatsAppMirrorMessage;

    expect(envelope["x-maxCanonicalBytes"]).toBe(262144);
    expect(message.required).toEqual(
      expect.arrayContaining([
        "quoted",
        "reaction",
        "interactive",
        "media",
        "location",
        "contacts",
        "poll",
        "edit",
        "delete"
      ])
    );
    expect(message.properties.text["x-maxUtf8Bytes"]).toBe(65536);
    expect(
      schemas.WhatsAppMirrorQuotedMessage.properties.text["x-maxUtf8Bytes"]
    ).toBe(4096);
    expect(message.properties).toEqual(
      expect.objectContaining({
        quoted: expect.any(Object),
        reaction: expect.any(Object),
        interactive: expect.any(Object),
        media: expect.any(Object),
        location: expect.any(Object),
        contacts: expect.any(Object),
        poll: expect.any(Object),
        edit: expect.any(Object),
        delete: expect.any(Object)
      })
    );
  });

  it("links webhook payloads to the envelope and documents the non-recursive serialized snapshot", () => {
    const schemas = messagingOpenApi.components.schemas;
    const snapshot = schemas.WhatsAppMirrorSerializedSnapshot;

    expect(snapshot.required).toEqual(["envelope", "rawBody", "bodySha256"]);
    expect(snapshot.properties.envelope).toEqual({
      $ref: "#/components/schemas/WhatsAppMirrorEnvelope"
    });
    expect(snapshot.properties.bodySha256.pattern).toBe("^[0-9a-f]{64}$");
    expect(snapshot.description).toContain("bodySha256 não integra o rawBody");
    expect(messagingOpenApi["x-webhook-events"].payloadSchema.oneOf).toEqual([
      { $ref: "#/components/schemas/LegacyWebhookEnvelope" },
      { $ref: "#/components/schemas/WhatsAppMirrorEnvelope" }
    ]);
    expect(schemas.LegacyWebhookEnvelope.required).not.toContain("schema");
    expect(schemas.WhatsAppMirrorEnvelope.required).toContain("schema");
    expect(messagingOpenApi["x-whatsapp-mirror-projection"]).toEqual({
      envelopeSchema: "#/components/schemas/WhatsAppMirrorEnvelope",
      serializedSnapshotSchema:
        "#/components/schemas/WhatsAppMirrorSerializedSnapshot",
      digestScope: "SHA-256 dos bytes UTF-8 exatos de rawBody"
    });
  });

  it("keeps legacy and mirror webhook branches mutually exclusive in a real schema probe", () => {
    const nullableMessage = {
      id: null,
      providerMessageId: null,
      direction: null,
      fromMe: null,
      type: null,
      text: null,
      timestamp: null,
      status: null,
      quoted: null,
      reaction: null,
      interactive: null,
      media: null,
      location: null,
      contacts: null,
      poll: null,
      edit: null,
      delete: null
    };
    const legacy = {
      id: "legacy-event",
      type: "message.received",
      createdAt: "2026-07-29T12:00:00.000Z",
      data: { messageId: "legacy-message" }
    };
    const mirror = {
      schema: "whatsapp-mirror/1",
      id: "11111111-1111-4111-8111-111111111111",
      type: "message.received",
      createdAt: "2026-07-29T12:00:00.000Z",
      data: {
        messageId: null,
        whatsappId: 42,
        conversationId: null,
        contactId: null,
        externalTicketId: null,
        automationEpoch: null,
        actorType: null,
        kind: null,
        origin: null,
        provider: {
          name: null,
          eventId: null,
          messageId: null,
          timestamp: null
        },
        connection: {
          id: 42,
          publicId: null,
          state: null,
          phoneNumber: null
        },
        contact: {
          id: null,
          jid: null,
          lid: null,
          phoneNumber: null,
          name: null,
          pushName: null,
          isBusiness: null
        },
        conversation: {
          id: null,
          externalTicketId: null,
          automationEpoch: null,
          status: null
        },
        chat: {
          jid: null,
          lid: null,
          type: null,
          name: null,
          archived: null,
          pinned: null,
          mutedUntil: null,
          unreadCount: null
        },
        message: nullableMessage,
        truncated: false
      }
    };

    expect(webhookBranchesMatched(legacy)).toBe(1);
    expect(webhookBranchesMatched(mirror)).toBe(1);
  });
});
