import WebhookFanoutService from "../WebhookFanoutService";

describe("WebhookFanoutService", () => {
  it("creates tenant-isolated deliveries with URL and secret snapshots", async () => {
    const createDelivery = jest.fn();
    const completeEvent = jest.fn();
    const transaction = {};
    const service = new WebhookFanoutService({
      transaction: callback => callback(transaction),
      claimEvent: jest.fn().mockResolvedValue({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          kind: "text",
          origin: "provider",
          text: "must-not-remain-in-jsonb"
        },
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
        leaseToken: "event-lease-1"
      }),
      findSubscriptions: jest.fn().mockResolvedValue([{
        id: "sub_1",
        companyId: 7,
        url: "https://hooks.example.com/diachat",
        events: ["message.received"],
        connectionIds: [42],
        messageKinds: ["text"],
        includeApiOrigin: false,
        secretCiphertext: "ciphertext",
        keyVersion: "v1"
      }]),
      createDelivery,
      completeEvent,
      buildSnapshot: jest.fn().mockResolvedValue({
        rawBody: "{\"schema\":\"whatsapp-mirror/1\"}",
        bodySha256: "snapshot-digest"
      }),
      encryptBody: jest.fn().mockReturnValue({
        bodyCiphertext: "encrypted-body",
        bodyKeyVersion: "body-v2",
        bodySha256: "snapshot-digest"
      }),
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "body-v2", keys: {} }),
      newId: jest.fn().mockReturnValue("del_1")
    });

    await expect(service.fanoutOne()).resolves.toEqual({ status: "created", deliveries: 1 });
    expect(createDelivery).toHaveBeenCalledWith(expect.objectContaining({
      id: "del_1",
      subscriptionId: "sub_1",
      companyId: 7,
      eventId: "evt_1",
      urlSnapshot: "https://hooks.example.com/diachat",
      secretCiphertextSnapshot: "ciphertext",
      bodyCiphertext: "encrypted-body",
      bodyKeyVersion: "body-v2",
      bodySha256: "snapshot-digest",
      bodyExpiresAt: null,
      bodyPurgedAt: null,
      payload: {
        messageId: "msg_1",
        whatsappId: 42,
        conversationId: null,
        contactId: null,
        externalTicketId: null,
        automationEpoch: null
      }
    }), transaction);
    expect(completeEvent).toHaveBeenCalledWith(
      "evt_1",
      "event-lease-1",
      transaction
    );
  });

  it("does not send public API-originated events unless explicitly enabled", async () => {
    const createDelivery = jest.fn();
    const service = new WebhookFanoutService({
      transaction: callback => callback({}),
      claimEvent: jest.fn().mockResolvedValue({ id: "evt_1", companyId: 7, eventType: "message.received", aggregateId: "msg_1", payload: { origin: "api" } }),
      findSubscriptions: jest.fn().mockResolvedValue([{ id: "sub_1", events: ["message.received"], connectionIds: [], messageKinds: [], includeApiOrigin: false }]),
      createDelivery,
      completeEvent: jest.fn()
    });
    await service.fanoutOne();
    expect(createDelivery).not.toHaveBeenCalled();
  });

  it.each(["projection", "encryption"])(
    "does not complete the claimed event after %s failure",
    async failure => {
      const completeEvent = jest.fn();
      const transaction = jest.fn(async callback => callback({}));
      const service = new WebhookFanoutService({
        transaction,
        claimEvent: jest.fn().mockResolvedValue({
          id: "evt_1",
          companyId: 7,
          eventType: "message.received",
          aggregateId: "msg_1",
          payload: { messageId: "msg_1" },
          createdAt: new Date("2026-07-29T12:00:00.000Z"),
          leaseToken: "event-lease-1"
        }),
        findSubscriptions: jest.fn().mockResolvedValue([
          {
            id: "sub_1",
            events: ["message.received"],
            connectionIds: [],
            messageKinds: [],
            includeApiOrigin: true
          }
        ]),
        createDelivery: jest.fn(),
        completeEvent,
        buildSnapshot:
          failure === "projection"
            ? jest.fn().mockRejectedValue(new Error("projection failed"))
            : jest.fn().mockResolvedValue({
                rawBody: "{}",
                bodySha256: "snapshot-digest"
              }),
        encryptBody:
          failure === "encryption"
            ? jest.fn(() => {
                throw new Error("encryption failed");
              })
            : jest.fn(),
        getKeyring: jest
          .fn()
          .mockReturnValue({ activeKeyId: "v1", keys: {} }),
        newId: jest.fn().mockReturnValue("del_1")
      });

      await expect(service.fanoutOne()).rejects.toThrow(`${failure} failed`);
      expect(completeEvent).not.toHaveBeenCalled();
    }
  );
});
