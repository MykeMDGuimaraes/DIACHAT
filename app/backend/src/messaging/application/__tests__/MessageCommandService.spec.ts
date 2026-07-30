import MessageCommandService from "../MessageCommandService";

describe("MessageCommandService", () => {
  const input = {
    companyId: 10,
    whatsappId: 2,
    provider: "baileys",
    messageKind: "text",
    recipient: "5511999999999",
    idempotencyScope: "cred_1",
    idempotencyKey: "request-12345678",
    requestPayload: { text: "Olá" }
  };

  it("returns the existing command for an idempotent replay", async () => {
    const existing = { id: "cmd_1", requestFingerprint: "same" };
    const service = new MessageCommandService({
      transaction: async callback => callback({}),
      findByIdempotencyKey: jest.fn().mockResolvedValue(existing),
      create: jest.fn(),
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "fingerprint").mockReturnValue("same");

    await expect(service.create(input)).resolves.toEqual({
      command: existing,
      replayed: true
    });
  });

  it("rejects a reused idempotency key with a different payload", async () => {
    const service = new MessageCommandService({
      transaction: async callback => callback({}),
      findByIdempotencyKey: jest
        .fn()
        .mockResolvedValue({ id: "cmd_1", requestFingerprint: "other" }),
      create: jest.fn(),
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "fingerprint").mockReturnValue("current");

    await expect(service.create(input)).rejects.toMatchObject({
      statusCode: 409,
      message: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("persists a dispatch event in the same transaction as a new command", async () => {
    const transaction = { id: "tx_1" };
    const createOutboxEvent = jest.fn().mockResolvedValue({ id: "outbox_1" });
    const service = new MessageCommandService({
      transaction: async callback => callback(transaction),
      findByIdempotencyKey: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "cmd_1" }),
      createOutboxEvent
    });

    await expect(service.create(input)).resolves.toMatchObject({
      command: { id: "cmd_1" },
      replayed: false
    });

    expect(createOutboxEvent).toHaveBeenCalledWith(
      {
        companyId: input.companyId,
        eventType: "message.dispatch.requested",
        aggregateId: "cmd_1",
        payload: { commandId: "cmd_1" },
        status: "ready",
        attemptCount: 0
      },
      transaction
    );
  });
});
