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
      header: jest.fn().mockReturnValue("legacy-client-key")
    };
    const res = response();

    await handler(req, res);

    expect(create).toHaveBeenCalledWith({
      companyId: 10,
      whatsappId: 2,
      idempotencyScope: "cred_1",
      idempotencyKey: expect.stringMatching(
        /^server:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
      recipient: "5511999999999",
      text: "Olá"
    });
    expect(create.mock.calls[0][0].idempotencyKey).not.toBe("legacy-client-key");
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      id: "cmd_1",
      status: "accepted",
      messageId: "msg_1"
    });
  });

  it("always returns 202 without exposing internal replay state", async () => {
    const create = jest.fn().mockResolvedValue({
        command: { id: "cmd_1", status: "queued" },
        message: null,
        replayed: true
    });
    const handler = createPublicTextMessageHandler({ create });
    const req: any = {
      apiCredential: { id: "cred_1", companyId: 10, connectionIds: [2] },
      body: { connectionId: 2, to: "5511999999999", text: "Olá" },
      header: jest.fn().mockReturnValue("request-12345678")
    };
    const res = response();

    await handler(req, res);

    expect(res.set).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it("generates a distinct internal key for each identical request", async () => {
    const create = jest.fn().mockResolvedValue({
      command: { id: "cmd_1", status: "queued" },
      message: null,
      replayed: false
    });
    const handler = createPublicTextMessageHandler({ create });
    const req: any = {
      apiCredential: { id: "cred_1", companyId: 10, connectionIds: [2] },
      body: { connectionId: 2, to: "5511999999999", text: "Olá" },
      header: jest.fn()
    };

    await handler(req, response());
    await handler(req, response());

    expect(create.mock.calls[0][0].idempotencyKey).not.toBe(
      create.mock.calls[1][0].idempotencyKey
    );
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
