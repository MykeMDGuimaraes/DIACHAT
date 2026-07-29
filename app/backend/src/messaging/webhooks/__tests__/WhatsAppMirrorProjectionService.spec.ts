import WhatsAppMirrorProjectionService from "../WhatsAppMirrorProjectionService";

describe("WhatsAppMirrorProjectionService", () => {
  it("hydrates and serializes the exact v1.1 envelope bytes", async () => {
    const service = new WhatsAppMirrorProjectionService({
      loadMessage: jest.fn().mockResolvedValue({
        id: "msg_1",
        body: "texto persistido",
        fromMe: false,
        mediaType: "text",
        createdAt: new Date("2026-07-29T11:59:59.000Z")
      })
    });

    await expect(
      service.buildLegacySnapshot({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          actorType: "contact",
          kind: "text",
          origin: "provider"
        },
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
        leaseToken: "event-lease-1"
      })
    ).resolves.toEqual({
      rawBody:
        "{\"id\":\"evt_1\",\"type\":\"message.received\",\"createdAt\":\"2026-07-29T12:00:00.000Z\",\"data\":{\"messageId\":\"msg_1\",\"whatsappId\":42,\"actorType\":\"contact\",\"kind\":\"text\",\"origin\":\"provider\",\"text\":\"texto persistido\"}}",
      bodySha256:
        "79aaa02b1dd17833b5ddcbc38bee62eaf930a9b7b83f17b27e611fd1dc8ee904"
    });
  });

  it("hydrates persisted message text before delegating to buildSnapshot", async () => {
    const snapshot = {
      envelope: { schema: "whatsapp-mirror/1" },
      rawBody: "{\"schema\":\"whatsapp-mirror/1\"}",
      bodySha256: "digest"
    };
    const buildSnapshot = jest.fn().mockReturnValue(snapshot);
    const service = new WhatsAppMirrorProjectionService({
      loadMessage: jest.fn().mockResolvedValue({
        id: "msg_1",
        body: "texto persistido",
        fromMe: false,
        mediaType: "text",
        createdAt: new Date("2026-07-29T11:59:59.000Z")
      }),
      builder: { buildSnapshot } as any
    });

    await expect(
      service.buildSnapshot({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          conversationId: "conv_1",
          contactId: "contact_1",
          actorType: "contact",
          kind: "text",
          origin: "provider"
        },
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
        leaseToken: "event-lease-1"
      })
    ).resolves.toBe(snapshot);
    expect(buildSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.received",
        occurredAt: new Date("2026-07-29T12:00:00.000Z"),
        identity: {
          companyId: 7,
          aggregateId: "msg_1",
          revision: null
        },
        correlation: expect.objectContaining({
          messageId: "msg_1",
          whatsappId: 42,
          conversationId: "conv_1",
          contactId: "contact_1"
        }),
        connection: expect.objectContaining({ id: 42 }),
        message: expect.objectContaining({
          id: "msg_1",
          type: "text",
          text: "texto persistido",
          fromMe: false,
          direction: "inbound"
        })
      })
    );
  });

  it("projects persisted media through the protected webhook-media service, including unavailable files", async () => {
    const buildSnapshot = jest.fn().mockReturnValue({
      envelope: {},
      rawBody: "{}",
      bodySha256: "digest"
    });
    const unavailableMedia = {
      type: "image",
      mimeType: "image/jpeg",
      fileName: "missing.jpg",
      sizeBytes: null,
      sha256: null,
      url: null,
      available: false,
      caption: "legenda"
    };
    const projectMedia = jest.fn().mockResolvedValue(unavailableMedia);
    const now = new Date("2026-07-29T12:05:00.000Z");
    const service = new WhatsAppMirrorProjectionService({
      loadMessage: jest.fn().mockResolvedValue({
        id: "msg_media",
        body: "legenda",
        fromMe: false,
        mediaType: "image",
        createdAt: new Date("2026-07-29T11:59:59.000Z")
      }),
      projectMedia,
      now: () => now,
      builder: { buildSnapshot } as any
    });

    await service.buildSnapshot({
      id: "evt_media",
      companyId: 7,
      eventType: "message.received",
      aggregateId: "msg_media",
      payload: {
        messageId: "msg_media",
        whatsappId: 42,
        actorType: "contact",
        kind: "image",
        origin: "provider"
      },
      createdAt: new Date("2026-07-29T12:00:00.000Z"),
      leaseToken: "event-lease-1"
    });

    expect(projectMedia).toHaveBeenCalledWith(7, "msg_media", now);
    expect(buildSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({ media: unavailableMedia })
      })
    );
  });
});
