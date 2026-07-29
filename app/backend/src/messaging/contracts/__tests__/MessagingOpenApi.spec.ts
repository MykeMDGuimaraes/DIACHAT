import messagingOpenApi from "../MessagingOpenApi";

describe("MessagingOpenApi 1.1", () => {
  it("publishes every Router P0 path as an authenticated full API path", () => {
    expect(messagingOpenApi.info.version).toBe("1.1.0");

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
    expect(
      messagingOpenApi.paths["/api/v1/openapi.json"].get.security
    ).toEqual([{ ApiKey: [] }]);
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
        "handoff.paused",
        "handoff.released",
        "conversation.created",
        "conversation.updated"
      ])
    );
  });
});
