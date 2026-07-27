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
        payload: { whatsappId: 42, kind: "text", origin: "provider" }
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
      completeEvent
    });

    await expect(service.fanoutOne()).resolves.toEqual({ status: "created", deliveries: 1 });
    expect(createDelivery).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: "sub_1",
      companyId: 7,
      eventId: "evt_1",
      urlSnapshot: "https://hooks.example.com/diachat",
      secretCiphertextSnapshot: "ciphertext",
      payload: expect.objectContaining({ id: "evt_1", type: "message.received" })
    }), transaction);
    expect(completeEvent).toHaveBeenCalledWith("evt_1", transaction);
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
});
