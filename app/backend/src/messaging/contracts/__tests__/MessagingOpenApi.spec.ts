import messagingOpenApi from "../MessagingOpenApi";

describe("MessagingOpenApi 1.2", () => {
  it("publishes every Router P0 path as an authenticated full API path", () => {
    expect(messagingOpenApi.info.version).toBe("1.2.0");

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
    expect(schemas.MessageRequest.properties.type.enum).toEqual([
      "text",
      "buttons"
    ]);
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
});
