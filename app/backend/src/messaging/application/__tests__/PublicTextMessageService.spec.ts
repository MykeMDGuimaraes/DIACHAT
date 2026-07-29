import PublicTextMessageService from "../PublicTextMessageService";

describe("PublicTextMessageService", () => {
  const input = {
    companyId: 10,
    whatsappId: 2,
    idempotencyScope: "credential_1",
    idempotencyKey: "request-12345678",
    recipient: "+55 (11) 99999-9999",
    text: "Olá"
  };

  it("persists the customer message, command and outbox event in one transaction", async () => {
    const transaction = { id: "tx_1" };
    const createMessage = jest.fn().mockResolvedValue({ id: "msg_1" });
    const createCommand = jest
      .fn()
      .mockResolvedValue({ id: "cmd_1", status: "queued" });
    const createOutboxEvent = jest.fn();
    const service = new PublicTextMessageService({
      transaction: async callback => callback(transaction),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2 }),
      findContact: jest.fn().mockResolvedValue(null),
      createContact: jest.fn().mockResolvedValue({ id: 3 }),
      findTicket: jest.fn().mockResolvedValue(null),
      createTicket: jest
        .fn()
        .mockResolvedValue({ id: 4, uuid: "conversation-uuid" }),
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
        body: "Olá"
      }),
      transaction
    );
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "cmd_1",
        messageId: "msg_1",
        recipient: "5511999999999",
        responseSnapshot: expect.objectContaining({
          id: "cmd_1",
          status: "accepted",
          messageId: "msg_1",
          conversationId: "conversation-uuid",
          contactId: "3"
        }),
        requestPayload: { ticketId: 4, text: "Olá" }
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
    expect(createOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "conversation.created",
        aggregateId: "conversation-uuid",
        payload: expect.objectContaining({
          conversationId: "conversation-uuid",
          contactId: "3",
          whatsappId: 2
        })
      }),
      transaction
    );
  });

  it("returns a replay without creating another message", async () => {
    const existing = {
      id: "cmd_1",
      requestFingerprint: "same",
      messageId: "msg_1",
      responseSnapshot: { id: "cmd_1", status: "accepted" }
    };
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

  it("reports an idempotent request without a frozen response as in progress", async () => {
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue({
        id: "cmd_1",
        requestFingerprint: "same",
        responseSnapshot: null
      }),
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

    await expect(service.create(input)).rejects.toEqual(
      expect.objectContaining({
        message: "REQUEST_IN_PROGRESS",
        statusCode: 409
      })
    );
  });

  it("returns the winning command when a concurrent insert hits the unique idempotency index", async () => {
    const existing = {
      id: "cmd_1",
      requestFingerprint: "same",
      messageId: "msg_1",
      responseSnapshot: { id: "cmd_1", status: "accepted" }
    };
    const service = new PublicTextMessageService({
      transaction: async callback => {
        await callback({});
        throw { name: "SequelizeUniqueConstraintError" };
      },
      findCommand: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValue(existing),
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
    const createCommand = jest
      .fn()
      .mockResolvedValue({ id: "cmd_1", status: "queued" });
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest
        .fn()
        .mockResolvedValue({ id: 2, channelType: "meta_cloud" }),
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
    const createCommand = jest
      .fn()
      .mockResolvedValue({ id: "cmd_2", status: "queued" });
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest
        .fn()
        .mockResolvedValue({ id: 2, channelType: "meta_cloud" }),
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

    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKind: "image",
        requestPayload: {
          ticketId: 4,
          link: "https://cdn.example.com/photo.jpg",
          caption: "Foto"
        }
      }),
      expect.anything()
    );
  });

  it("persists native buttons and Router correlation without changing callback ids", async () => {
    const createCommand = jest
      .fn()
      .mockResolvedValue({ id: "cmd_buttons", status: "queued" });
    const reserveAutomatedMessage = jest.fn();
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(null),
      findWhatsapp: jest.fn().mockResolvedValue({ id: 2, status: "CONNECTED" }),
      findContact: jest.fn().mockResolvedValue({ id: 3 }),
      createContact: jest.fn(),
      findTicket: jest.fn().mockResolvedValue({
        id: 4,
        uuid: "conversation-uuid"
      }),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn().mockResolvedValue({ id: "msg_buttons" }),
      createCommand,
      createOutboxEvent: jest.fn(),
      reserveAutomatedMessage
    });
    jest.spyOn(service, "createCommandId").mockReturnValue("cmd_buttons");

    await service.create({
      ...input,
      text: "Escolha",
      kind: "buttons",
      payload: {
        buttons: [
          { id: "accept:ticket_1", title: "Aceitar" },
          { id: "reject:ticket_1", title: "Recusar" }
        ]
      },
      externalTicketId: "ticket_1",
      automationEpoch: 4
    });

    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        messageKind: "buttons",
        externalTicketId: "ticket_1",
        automationEpoch: 4,
        conversationId: "conversation-uuid",
        requestPayload: {
          ticketId: 4,
          text: "Escolha",
          buttons: [
            { id: "accept:ticket_1", title: "Aceitar" },
            { id: "reject:ticket_1", title: "Recusar" }
          ]
        }
      }),
      expect.anything()
    );
    expect(reserveAutomatedMessage).toHaveBeenCalledWith({
      companyId: 10,
      conversationId: "conversation-uuid",
      externalTicketId: "ticket_1",
      automationEpoch: 4,
      transaction: expect.anything()
    });
    expect(
      reserveAutomatedMessage.mock.invocationCallOrder[0]
    ).toBeLessThan(createCommand.mock.invocationCallOrder[0]);
  });

  it("rejects button payloads that exceed the native quick-reply contract", async () => {
    const service = new PublicTextMessageService({} as any);

    await expect(
      service.create({
        ...input,
        kind: "buttons",
        payload: {
          buttons: [
            { id: "one", title: "Um" },
            { id: "two", title: "Dois" },
            { id: "three", title: "Tres" },
            { id: "four", title: "Quatro" }
          ]
        },
        externalTicketId: "ticket_1",
        automationEpoch: 0
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("does not fall back to text when the selected provider lacks native buttons", async () => {
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn(),
      findWhatsapp: jest.fn().mockResolvedValue({
        id: 2,
        channelType: "meta_cloud"
      }),
      findContact: jest.fn(),
      createContact: jest.fn(),
      findTicket: jest.fn(),
      createTicket: jest.fn(),
      updateTicket: jest.fn(),
      createMessage: jest.fn(),
      createCommand: jest.fn(),
      createOutboxEvent: jest.fn()
    });

    await expect(
      service.create({
        ...input,
        kind: "buttons",
        payload: { buttons: [{ id: "accept:1", title: "Aceitar" }] },
        externalTicketId: "ticket_1",
        automationEpoch: 0
      })
    ).rejects.toMatchObject({
      statusCode: 422,
      message: "CAPABILITY_NOT_SUPPORTED"
    });
  });

  it("replays from the frozen command even when the channel was removed", async () => {
    const existing = {
      id: "cmd_1",
      requestFingerprint: "same",
      responseSnapshot: {
        id: "cmd_1",
        status: "accepted",
        conversationId: "conversation-uuid"
      }
    };
    const findWhatsapp = jest.fn().mockResolvedValue(null);
    const service = new PublicTextMessageService({
      transaction: async callback => callback({}),
      findCommand: jest.fn().mockResolvedValue(existing),
      findWhatsapp,
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
    expect(findWhatsapp).not.toHaveBeenCalled();
  });
});
