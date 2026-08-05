import OutboundMessageService, {
  CreateOutboundMessageInput
} from "../OutboundMessageService";

const ticket = {
  id: 10,
  uuid: "uuid-10",
  companyId: 1,
  whatsappId: 2,
  contact: { id: 55, number: "5511999999999" }
};
const whatsapp = { id: 2, companyId: 1, channelType: "whatsapp" };

const makeDeps = () => {
  const tx = { LOCK: { UPDATE: "UPDATE" } };
  const deps = {
    transaction: jest.fn(async (callback: any) => callback(tx)),
    findCommand: jest.fn().mockResolvedValue(null),
    findTicketById: jest.fn().mockResolvedValue(ticket),
    findWhatsapp: jest.fn().mockResolvedValue(whatsapp),
    findContact: jest.fn().mockResolvedValue(null),
    createContact: jest.fn(async (data: any) => ({ id: 56, ...data })),
    findOpenTicket: jest.fn().mockResolvedValue(null),
    createTicket: jest.fn(async (data: any) => ({
      id: 11,
      uuid: "uuid-11",
      contact: { id: 56, number: data.number || "5511988887777" },
      ...data
    })),
    updateTicket: jest.fn().mockResolvedValue([1]),
    findQuotedMessage: jest.fn().mockResolvedValue({ id: "quoted-1" }),
    createMessage: jest.fn(async (data: any) => ({ ...data })),
    createCommand: jest.fn(async (data: any) => ({ ...data })),
    createOutboxEvent: jest.fn(async (data: any) => ({ ...data }))
  };
  return { deps, tx };
};

const baseInput = (): CreateOutboundMessageInput => ({
  companyId: 1,
  ticketId: 10,
  idempotencyScope: "screen",
  idempotencyKey: "screen-key-1",
  kind: "text",
  text: "ola",
  origin: "screen"
});

const createCaptured = async () => {
  const { deps } = makeDeps();
  const service = new OutboundMessageService(deps as any);
  const result = await service.create(baseInput());
  return result.command;
};

describe("OutboundMessageService", () => {
  it("cria Message, comando e evento de outbox na mesma transacao", async () => {
    const { deps, tx } = makeDeps();
    const service = new OutboundMessageService(deps as any);

    const result = await service.create(baseInput());

    expect(result.replayed).toBe(false);
    expect(result.command.id).toBe(result.message.id);
    expect(deps.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.command.id,
        ticketId: 10,
        fromMe: true,
        ack: 0,
        body: "ola"
      }),
      tx
    );
    expect(deps.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.command.id,
        messageId: result.message.id,
        status: "queued",
        requestFingerprint: expect.any(String),
        responseSnapshot: expect.objectContaining({ status: "accepted" })
      }),
      tx
    );
    expect(deps.createOutboxEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "message.dispatch.requested",
        status: "ready",
        aggregateId: result.command.id
      }),
      tx
    );
  });

  it("retry com a mesma chave retorna o snapshot original com replayed=true", async () => {
    const captured = await createCaptured();
    const { deps } = makeDeps();
    deps.findCommand.mockResolvedValue(captured);
    const service = new OutboundMessageService(deps as any);

    const result = await service.create(baseInput());

    expect(result.replayed).toBe(true);
    expect(result.command).toBe(captured);
    expect(deps.createMessage).not.toHaveBeenCalled();
    expect(deps.createCommand).not.toHaveBeenCalled();
  });

  it("mesma chave com conteudo diferente retorna 409 IDEMPOTENCY_CONFLICT", async () => {
    const captured = await createCaptured();
    const { deps } = makeDeps();
    deps.findCommand.mockResolvedValue(captured);
    const service = new OutboundMessageService(deps as any);

    await expect(
      service.create({ ...baseInput(), text: "conteudo diferente" })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "IDEMPOTENCY_CONFLICT"
    });
  });

  it("comando sem snapshot sinaliza REQUEST_IN_PROGRESS", async () => {
    const captured = await createCaptured();
    const { deps } = makeDeps();
    deps.findCommand.mockResolvedValue({ ...captured, responseSnapshot: null });
    const service = new OutboundMessageService(deps as any);

    await expect(service.create(baseInput())).rejects.toMatchObject({
      statusCode: 409,
      message: "REQUEST_IN_PROGRESS"
    });
  });

  it("quotedMessageId inexistente no ticket retorna 400", async () => {
    const { deps } = makeDeps();
    deps.findQuotedMessage.mockResolvedValue(null);
    const service = new OutboundMessageService(deps as any);

    await expect(
      service.create({ ...baseInput(), quotedMessageId: "nao-existe" })
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Mensagem citada invalida"
    });
  });

  it("corrida de chave unica recupera o comando vencedor como replay", async () => {
    const captured = await createCaptured();
    const { deps } = makeDeps();
    deps.transaction.mockRejectedValue({
      name: "SequelizeUniqueConstraintError"
    });
    deps.findCommand.mockResolvedValue(captured);
    const service = new OutboundMessageService(deps as any);

    const result = await service.create(baseInput());

    expect(result.replayed).toBe(true);
    expect(result.command).toBe(captured);
  });

  it("ticket inexistente retorna 404", async () => {
    const { deps } = makeDeps();
    deps.findTicketById.mockResolvedValue(null);
    const service = new OutboundMessageService(deps as any);

    await expect(service.create(baseInput())).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("caminho por recipient (automacao) resolve contato e ticket", async () => {
    const { deps } = makeDeps();
    const service = new OutboundMessageService(deps as any);

    const result = await service.create({
      companyId: 1,
      whatsappId: 2,
      recipient: "5511988887777",
      idempotencyScope: "automation-flow",
      idempotencyKey: "flow-key-1",
      kind: "text",
      text: "mensagem automatica",
      origin: "automation"
    });

    expect(result.replayed).toBe(false);
    expect(deps.createContact).toHaveBeenCalled();
    expect(deps.createTicket).toHaveBeenCalled();
    expect(deps.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappId: 2,
        recipient: "5511988887777",
        messageKind: "text"
      }),
      expect.anything()
    );
  });

  it("midia com localPath duravel cria comando do kind correto", async () => {
    const { deps } = makeDeps();
    const service = new OutboundMessageService(deps as any);

    const result = await service.create({
      ...baseInput(),
      idempotencyKey: "batch-9:0",
      kind: "image",
      text: undefined,
      payload: {
        localPath: "messaging/uuid-foto.jpg",
        caption: "Foto",
        mimeType: "image/jpeg"
      }
    });

    expect(result.command.messageKind).toBe("image");
    expect(deps.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "image",
        mediaUrl: "messaging/uuid-foto.jpg",
        body: "Foto"
      }),
      expect.anything()
    );
  });

  it("midia sem origem duravel e rejeitada com 400", async () => {
    const { deps } = makeDeps();
    const service = new OutboundMessageService(deps as any);

    await expect(
      service.create({
        ...baseInput(),
        kind: "image",
        text: undefined,
        payload: { localPath: "tmp/inseguro.jpg" }
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  const mediaInput = (localPath: string): CreateOutboundMessageInput => ({
    ...baseInput(),
    kind: "image",
    text: undefined,
    payload: {
      localPath,
      caption: "Foto",
      fileName: "f.jpg",
      mimeType: "image/jpeg"
    }
  });

  const captureMediaCommand = async () => {
    const { deps } = makeDeps();
    const service = new OutboundMessageService(deps as any);
    const { command } = await service.create(
      mediaInput("messaging/original.jpg")
    );
    return command;
  };

  it("findReplay retorna null quando a chave ainda nao existe", async () => {
    const { deps } = makeDeps();
    const service = new OutboundMessageService(deps as any);

    const replay = await service.findReplay(baseInput());

    expect(replay).toBeNull();
  });

  it("findReplay reutiliza o comando aceito mesmo com localPath novo no retry", async () => {
    const command = await captureMediaCommand();
    const { deps } = makeDeps();
    deps.findCommand.mockResolvedValue(command);
    const service = new OutboundMessageService(deps as any);

    const replay = await service.findReplay(
      mediaInput("messaging/retry-novo.jpg")
    );

    expect(replay?.command).toBe(command);
  });

  it("findReplay rejeita retry com conteudo semantico diferente", async () => {
    const command = await captureMediaCommand();
    const { deps } = makeDeps();
    deps.findCommand.mockResolvedValue(command);
    const service = new OutboundMessageService(deps as any);

    await expect(
      service.findReplay({
        ...mediaInput("messaging/retry.jpg"),
        payload: {
          localPath: "messaging/retry.jpg",
          caption: "Outra legenda",
          fileName: "f.jpg",
          mimeType: "image/jpeg"
        }
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "IDEMPOTENCY_CONFLICT"
    });
  });
});
