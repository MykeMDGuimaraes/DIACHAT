import { createPublicTextMessageHandler } from "../PublicMessageController";

describe("PublicMessageController", () => {
  const response = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
  };

  it("returns 202 only after the durable message command was persisted", async () => {
    const create = jest.fn().mockResolvedValue({
      command: { id: "cmd_1", status: "queued" },
      message: { id: "msg_1" },
      replayed: false
    });
    const handler = createPublicTextMessageHandler({ create });
    const req: any = {
      apiCredential: {
        id: "cred_1",
        companyId: 10,
        scopes: ["messages:write"],
        connectionIds: [2]
      },
      body: { connectionId: 2, to: "5511999999999", text: "Olá" },
      header: jest.fn().mockReturnValue("request-12345678")
    };
    const res = response();

    await handler(req, res);

    expect(create).toHaveBeenCalledWith({
      companyId: 10,
      whatsappId: 2,
      idempotencyScope: "cred_1",
      idempotencyKey: "request-12345678",
      recipient: "5511999999999",
      text: "Olá"
    });
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      id: "cmd_1",
      status: "accepted",
      messageId: "msg_1"
    });
  });

  it("adds the replay header for an idempotent retry", async () => {
    const handler = createPublicTextMessageHandler({
      create: jest.fn().mockResolvedValue({
        command: { id: "cmd_1", status: "queued" },
        message: null,
        replayed: true
      })
    });
    const req: any = {
      apiCredential: { id: "cred_1", companyId: 10, connectionIds: [2] },
      body: { connectionId: 2, to: "5511999999999", text: "Olá" },
      header: jest.fn().mockReturnValue("request-12345678")
    };
    const res = response();

    await handler(req, res);

    expect(res.set).toHaveBeenCalledWith("Idempotent-Replayed", "true");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("forwards a supported media payload to the durable command service", async () => {
    const create = jest.fn().mockResolvedValue({
      command: { id: "cmd_media", status: "queued" },
      message: { id: "msg_media" },
      replayed: false
    });
    const handler = createPublicTextMessageHandler({ create });
    const req: any = {
      apiCredential: { id: "cred_1", companyId: 10, connectionIds: [2] },
      body: {
        connectionId: 2,
        to: "5511999999999",
        type: "image",
        media: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
      },
      header: jest.fn().mockReturnValue("request-media-123")
    };

    await handler(req, response());

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "image",
        payload: { link: "https://cdn.example.com/photo.jpg", caption: "Foto" }
      })
    );
  });

  it("returns the stable accepted response and forwards Router correlation", async () => {
    const create = jest.fn().mockResolvedValue({
      command: {
        id: "cmd_buttons",
        status: "queued",
        messageId: "msg_buttons",
        conversationId: "conversation-uuid",
        contactId: "3"
      },
      message: { id: "msg_buttons" },
      replayed: false
    });
    const handler = createPublicTextMessageHandler({ create } as any);
    const req: any = {
      apiCredential: { id: "cred_1", companyId: 10, connectionIds: [2] },
      body: {
        connectionId: 2,
        to: "5511999999999",
        type: "buttons",
        text: "Escolha",
        buttons: [{ id: "accept:ticket_1", title: "Aceitar" }],
        externalTicketId: "ticket_1",
        automationEpoch: 4
      },
      header: jest.fn().mockReturnValue("request-buttons-123")
    };
    const res = response();

    await handler(req, res);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "buttons",
        text: "Escolha",
        payload: {
          buttons: [{ id: "accept:ticket_1", title: "Aceitar" }]
        },
        externalTicketId: "ticket_1",
        automationEpoch: 4
      })
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      id: "cmd_buttons",
      status: "accepted",
      messageId: "msg_buttons",
      conversationId: "conversation-uuid",
      contactId: "3"
    });
  });
});
