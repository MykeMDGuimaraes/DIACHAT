import { promises as fs } from "fs";
import os from "os";
import path from "path";

import WebhookMediaService from "../WebhookMediaService";
import { signWebhookMediaUrl } from "../WebhookMediaToken";
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

  it("serializes an available file through the real media service and real payload builder", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "diachat-projection-media-")
    );
    const storedPath = "company-7/photo.jpg";
    const absolutePath = path.join(root, storedPath);
    const now = new Date("2026-07-29T12:05:00.000Z");
    const keyring = {
      activeKeyId: "v1",
      keys: { v1: Buffer.alloc(32, 7).toString("base64") }
    };
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from("available-media", "utf8"));
    const storedMessage = {
      id: "msg_media",
      storedPath,
      mediaType: "image",
      body: "legenda",
      fromMe: false,
      createdAt: new Date("2026-07-29T11:59:59.000Z")
    };
    const mediaService = new WebhookMediaService({
      root,
      loadMessage: jest.fn().mockResolvedValue(storedMessage),
      signUrl: (messageId, companyId, issuedAt) =>
        signWebhookMediaUrl(messageId, companyId, issuedAt, keyring)
    });
    const projection = new WhatsAppMirrorProjectionService({
      loadMessage: jest.fn().mockResolvedValue(storedMessage),
      projectMedia: (companyId, messageId, issuedAt) =>
        mediaService.project(companyId, messageId, issuedAt),
      now: () => now
    });

    try {
      const snapshot = await projection.buildSnapshot({
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
      const media = JSON.parse(snapshot.rawBody).data.message.media;

      expect(media).toMatchObject({
        available: true,
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 15
      });
      expect(media.url).toContain("/api/v1/webhook-media/msg_media?");
      expect(media.url).toMatch(/[?&]sig=[a-f0-9]{64}(?:&|$)/);
      expect(media.url).not.toContain("token=");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
