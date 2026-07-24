import PublicTextMessageService from "../PublicTextMessageService";

describe("PublicTextMessageService", () => {
  const input = {
    companyId: 10,
    whatsappId: 2,
    idempotencyScope: "credential_1",
    idempotencyKey: "request-12345678",
    recipient: "+55 (11) 99999-9999",
    text: "OlÃ¡"
  };

  it("persists the customer message, command and outbox event in one transaction", async () => {
    const transaction = { id: "tx_1" };
    const createMessage = jest.fn().mockResolvedValue({ id: "msg_1" });
    const createCommand = jest.fn().mockResolvedValue({ id: "cmd_1", status: "queued" });
    const createOutboxEvent = jest.fn();
    const service = new PublicTextMessageService({
      transaction: async callback => callback(transaction),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2 }),
      findContact: jest.fn().mockResolvedValue(null),
      createContact: jest.fn().mockResolvedValue({ id: 3 }),
      findTicket: jest.fn().mockResolvedValue(null),
      createTicket: jest.fn().mockResolvedValue({ id: 4 }),
      updateTicket: jest.fn(),
      createMessage,
      createCommand,
      createOutboxEvent
    });
    jest.spyOn(service, "createCommandId").mockReturnValue("cmd_1");

    await expect(service.create(input)).resolves.toMatchObject({
      replayed: false,
      command: { id: "cmd_1", status: "queued" },
      message: { id: "msg_1" }
    });

    expect(createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cmd_1",
        ticketId: 4,
        contactId: 3,
        fromMe: true,
        body: "OlÃ¡"
      }),
      transaction
    );
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cmd_1",
        messageId: "msg_1",
        recipient: "5511999999999",
        requestPayload: { ticketId: 4, text: "OlÃ¡" }
      }),
      transaction
    );
    expect(createOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        aggregateId: "cmd_1",
        payload: { commandId: "cmd_1" }
      }),
      transaction
    );
  });

  it("returns a replay without creating another message", async () => {
    const existing = { id: "cmd_1", requestFingerprint: "same", messageId: "msg_1" };
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(existing),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2 }),
      findContact: jest.fn(),
      createContact: jest.fn(),
      findTicket: jest.fn(),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn(),
      createCommand: jest.fn(),
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "fingerprint").mockReturnValue("same");

    await expect(service.create(input)).resolves.toEqual({
      command: existing,
      message: null,
      replayed: true
    });
  });

  it("returns the winning command when a concurrent insert hits the unique idempotency index", async () => {
    const existing = { id: "cmd_1", requestFingerprint: "same", messageId: "msg_1" };
    const service = new PublicTextMessageService({
      transaction: async callback => {
        await callback({});
        throw { name: "SequelizeUniqueConstraintError" };
      },
      findCommand: jest.fn().mockResolvedValueOnce(null).mockResolvedValue(existing),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2 }),
      findContact: jest.fn().mockResolvedValue({ id: 3 }),
      createContact: jest.fn(),
      findTicket: jest.fn().mockResolvedValue({ id: 4 }),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn().mockResolvedValue({ id: "msg_1" }),
      createCommand: jest.fn().mockResolvedValue({ id: "cmd_1" }),
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "fingerprint").mockReturnValue("same");

    await expect(service.create(input)).resolves.toEqual({
      command: existing,
      message: null,
      replayed: true
    });
  });

  it("routes a text command to Meta Cloud when the selected channel is official", async () => {
    const createCommand = jest.fn().mockResolvedValue({ id: "cmd_1", status: "queued" });
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2, channelType: "meta_cloud" }),
      findContact: jest.fn().mockResolvedValue({ id: 3 }),
      createContact: jest.fn(),
      findTicket: jest.fn().mockResolvedValue({ id: 4 }),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn().mockResolvedValue({ id: "msg_1" }),
      createCommand,
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "createCommandId").mockReturnValue("cmd_1");

    await service.create(input);

    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "meta_cloud" }),
      expect.anything()
    );
  });

  it("persists a media command with its immutable provider payload", async () => {
    const createCommand = jest.fn().mockResolvedValue({ id: "cmd_2", status: "queued" });
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2, channelType: "meta_cloud" }),
      findContact: jest.fn().mockResolvedValue({ id: 3 }),
      createContact: jest.fn(),
      findTicket: jest.fn().mockResolvedValue({ id: 4 }),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn().mockResolvedValue({ id: "msg_2" }),
      createCommand,
      createOutboxEvent: jest.fn()
    });
    jest.spyOn(service, "createCommandId").mockReturnValue("cmd_2");

    await service.create({
      ...input,
      text: undefined as any,
      kind: "image",
      payload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
    });

    expect(createCommand).toHaveBeenCalledWith(expect.objectContaining({
      messageKind: "image",
      requestPayload: {
        ticketId: 4,
        link: "https://cdn.example.com/photo.jpg",
        caption: "Foto"
      }
    }), expect.anything());
  });
});
