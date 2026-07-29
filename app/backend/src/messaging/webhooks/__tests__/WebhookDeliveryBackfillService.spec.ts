import WebhookDeliveryBackfillService from "../WebhookDeliveryBackfillService";

const now = new Date("2026-07-29T12:00:00.000Z");
const legacy = {
  id: "del_1",
  companyId: 7,
  subscriptionId: "sub_1",
  eventId: "evt_1",
  eventType: "message.received",
  status: "ready",
  payload: {
    id: "legacy-envelope-id",
    type: "message.received",
    createdAt: "2026-07-24T12:00:00.000Z",
    data: {
      messageId: "msg_1",
      whatsappId: 42,
      conversationId: "conv_1",
      text: "legacy-plaintext"
    }
  },
  createdAt: new Date("2026-07-24T12:00:00.000Z"),
  leaseToken: "backfill-lease-1"
};

const dependencies = (overrides: Record<string, unknown> = {}) =>
  ({
    claimLegacy: jest.fn().mockResolvedValue(legacy),
    buildSnapshot: jest.fn().mockResolvedValue({
      rawBody: "{\"schema\":\"whatsapp-mirror/1\"}",
      bodySha256: "snapshot-digest"
    }),
    encryptBody: jest.fn().mockReturnValue({
      bodyCiphertext: "encrypted-body",
      bodyKeyVersion: "v2",
      bodySha256: "snapshot-digest"
    }),
    getKeyring: jest
      .fn()
      .mockReturnValue({ activeKeyId: "v2", keys: {} }),
    persistEncrypted: jest.fn(),
    scrubDelivered: jest.fn(),
    releaseClaim: jest.fn(),
    countActivePlaintext: jest.fn().mockResolvedValue(0),
    now: jest.fn().mockReturnValue(now),
    ...overrides
  } as any);

describe("WebhookDeliveryBackfillService", () => {
  it("hydrates/project legacy data, encrypts active bodies, and scrubs JSONB", async () => {
    const deps = dependencies();
    const service = new WebhookDeliveryBackfillService(deps);

    await expect(service.processOne()).resolves.toEqual({
      status: "encrypted"
    });
    expect(deps.buildSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "evt_1",
        aggregateId: "msg_1",
        payload: expect.objectContaining({
          messageId: "msg_1",
          whatsappId: 42
        })
      })
    );
    expect(deps.encryptBody).toHaveBeenCalledWith(
      Buffer.from("{\"schema\":\"whatsapp-mirror/1\"}", "utf8"),
      {
        companyId: 7,
        subscriptionId: "sub_1",
        deliveryId: "del_1",
        eventId: "evt_1"
      },
      { activeKeyId: "v2", keys: {} }
    );
    expect(deps.persistEncrypted).toHaveBeenCalledWith(
      "del_1",
      "backfill-lease-1",
      expect.objectContaining({
        bodyCiphertext: "encrypted-body",
        bodyKeyVersion: "v2",
        bodySha256: "snapshot-digest",
        bodyExpiresAt: null,
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          conversationId: "conv_1",
          contactId: null,
          externalTicketId: null,
          automationEpoch: null
        }
      })
    );
  });

  it("retains migrated dead-letter ciphertext for 168 hours", async () => {
    const persistEncrypted = jest.fn();
    const service = new WebhookDeliveryBackfillService(
      dependencies({
        claimLegacy: jest
          .fn()
          .mockResolvedValue({ ...legacy, status: "dead_letter" }),
        persistEncrypted
      })
    );

    await service.processOne();

    expect(persistEncrypted).toHaveBeenCalledWith(
      "del_1",
      "backfill-lease-1",
      expect.objectContaining({
        bodyExpiresAt: new Date("2026-08-05T12:00:00.000Z")
      })
    );
  });

  it("scrubs delivered plaintext without rebuilding a body", async () => {
    const buildSnapshot = jest.fn();
    const scrubDelivered = jest.fn();
    const service = new WebhookDeliveryBackfillService(
      dependencies({
        claimLegacy: jest
          .fn()
          .mockResolvedValue({ ...legacy, status: "delivered" }),
        buildSnapshot,
        scrubDelivered
      })
    );

    await expect(service.processOne()).resolves.toEqual({
      status: "scrubbed"
    });
    expect(buildSnapshot).not.toHaveBeenCalled();
    expect(scrubDelivered).toHaveBeenCalledWith(
      "del_1",
      "backfill-lease-1",
      {
        messageId: "msg_1",
        whatsappId: 42,
        conversationId: "conv_1",
        contactId: null,
        externalTicketId: null,
        automationEpoch: null
      },
      now
    );
  });

  it("releases the claim and leaves the row resumable after projection failure", async () => {
    const releaseClaim = jest.fn();
    const persistEncrypted = jest.fn();
    const service = new WebhookDeliveryBackfillService(
      dependencies({
        buildSnapshot: jest.fn().mockRejectedValue(new Error("projection failed")),
        persistEncrypted,
        releaseClaim
      })
    );

    await expect(service.processOne()).rejects.toThrow("projection failed");
    expect(persistEncrypted).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith(
      "del_1",
      "backfill-lease-1"
    );
  });

  it("reports startup unsafe while active plaintext remains after a batch", async () => {
    const service = new WebhookDeliveryBackfillService(
      dependencies({
        claimLegacy: jest
          .fn()
          .mockResolvedValueOnce(legacy)
          .mockResolvedValue(null),
        countActivePlaintext: jest.fn().mockResolvedValue(2)
      })
    );

    await expect(service.runBatch(10)).resolves.toEqual({
      processed: 1,
      safeToDispatch: false
    });
  });
});
