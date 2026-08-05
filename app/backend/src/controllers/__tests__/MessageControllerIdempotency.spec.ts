import AppError from "../../errors/AppError";

jest.mock("../../helpers/SetTicketMessagesAsRead", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../libs/socket", () => ({ getIO: jest.fn() }));
jest.mock("../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));
jest.mock("../../models/Ticket", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Queue", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/User", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Whatsapp", () => ({
  __esModule: true,
  default: { findByPk: jest.fn() }
}));
jest.mock("../../models/V1MessageIdempotency", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() }
}));
jest.mock("../../helpers/Mustache", () => ({
  __esModule: true,
  default: (body: string) => body
}));
jest.mock("../../services/MessageServices/ListMessagesService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/MessageServices/CreateMessageService", () => ({
  __esModule: true,
  notifyCreatedMessage: jest.fn()
}));
jest.mock("../../services/TicketServices/ShowTicketService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/TicketServices/FindOrCreateTicketService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/TicketServices/UpdateTicketService", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/DeleteWhatsAppMessage", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/CheckNumber", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/GetProfilePicUrl", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../helpers/GetTicketWbot", () => ({
  __esModule: true,
  default: jest.fn()
}));
const mockPersistUpload = jest.fn(async () => "messaging/arquivo-1");
jest.mock("../../messaging/application/persistMessagingUpload", () => ({
  persistMessagingUpload: mockPersistUpload,
  messageKindForMime: jest.fn(() => "image")
}));
jest.mock(
  "../../services/ContactServices/CreateOrUpdateContactService",
  () => ({ __esModule: true, default: jest.fn() })
);

const mockCreate = jest.fn();
const mockFindReplay = jest.fn();
jest.mock("../../messaging/application/OutboundMessageService", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    findReplay: mockFindReplay
  }))
}));

/* eslint-disable import/first */
import { store, send, sendMessageFlow } from "../MessageController";
import ShowTicketService from "../../services/TicketServices/ShowTicketService";
import V1MessageIdempotency from "../../models/V1MessageIdempotency";
import Message from "../../models/Message";
import Whatsapp from "../../models/Whatsapp";
import CheckContactNumber from "../../services/WbotServices/CheckNumber";
import GetProfilePicUrl from "../../services/WbotServices/GetProfilePicUrl";
import CreateOrUpdateContactService from "../../services/ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../../services/TicketServices/FindOrCreateTicketService";
import { notifyCreatedMessage } from "../../services/MessageServices/CreateMessageService";
/* eslint-enable import/first */

const mockedWhatsapp = Whatsapp as unknown as { findByPk: jest.Mock };
const mockedCheckNumber = CheckContactNumber as jest.MockedFunction<
  typeof CheckContactNumber
>;
const mockedProfilePic = GetProfilePicUrl as jest.MockedFunction<
  typeof GetProfilePicUrl
>;
const mockedUpsertContact = CreateOrUpdateContactService as jest.MockedFunction<
  typeof CreateOrUpdateContactService
>;
const mockedFindOrCreateTicket =
  FindOrCreateTicketService as jest.MockedFunction<
    typeof FindOrCreateTicketService
  >;

const mockedShowTicket = ShowTicketService as jest.MockedFunction<
  typeof ShowTicketService
>;
const mockedIdem = V1MessageIdempotency as unknown as {
  findOne: jest.Mock;
  create: jest.Mock;
};
const mockedMessage = Message as unknown as { findByPk: jest.Mock };
const mockedNotify = notifyCreatedMessage as jest.MockedFunction<
  typeof notifyCreatedMessage
>;

const makeReq = (clientMessageId?: string, extraBody: any = {}): any => ({
  params: { ticketId: "10" },
  body: { body: "hello", clientMessageId, ...extraBody },
  files: undefined,
  user: { companyId: 1, id: "1", profile: "admin" }
});

const makeRes = (): any => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
};

const acceptedCommand = (id = "cmd-1") => ({
  command: { id, messageId: id, status: "queued" },
  message: { id },
  replayed: false
});

describe("MessageController.store — aceitacao duravel pelo outbox (Task 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShowTicket.mockResolvedValue({ id: 10 } as any);
    mockedMessage.findByPk.mockResolvedValue({ id: "cmd-1" });
    mockedIdem.create.mockResolvedValue({});
    mockFindReplay.mockResolvedValue(null);
  });

  it("texto sem clientMessageId e aceito com 202 queued", async () => {
    mockCreate.mockResolvedValue(acceptedCommand());
    const res = makeRes();

    await store(makeReq(), res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        idempotencyScope: "screen",
        kind: "text",
        text: "hello",
        origin: "screen"
      })
    );
    expect(mockedIdem.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      commandId: "cmd-1",
      messageId: "cmd-1",
      status: "queued",
      replayed: false
    });
  });

  it("texto com clientMessageId usa a chave como idempotencia e mantem a ponte V1", async () => {
    mockedIdem.findOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue(acceptedCommand());
    const res = makeRes();

    await store(makeReq("abc-12345"), res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "abc-12345" })
    );
    expect(mockedIdem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        clientMessageId: "abc-12345",
        messageId: "cmd-1"
      })
    );
    expect(mockedNotify).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it("replay do nucleo retorna 202 replayed sem recriar nada", async () => {
    mockedIdem.findOne.mockResolvedValue(null);
    mockCreate.mockResolvedValue({ ...acceptedCommand(), replayed: true });
    const res = makeRes();

    await store(makeReq("abc-12345"), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      commandId: "cmd-1",
      messageId: "cmd-1",
      status: "queued",
      replayed: true
    });
    expect(mockedIdem.create).not.toHaveBeenCalled();
    expect(mockedNotify).not.toHaveBeenCalled();
  });

  it("chave da era sincrona com messageId responde replay sem reenviar", async () => {
    mockedIdem.findOne.mockResolvedValue({ messageId: "wa-old-1" });
    const res = makeRes();

    await store(makeReq("abc-12345"), res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      commandId: "wa-old-1",
      messageId: "wa-old-1",
      status: "sent",
      replayed: true
    });
  });

  it("chave da era sincrona ainda em voo responde 409", async () => {
    mockedIdem.findOne.mockResolvedValue({ messageId: null });

    await expect(store(makeReq("abc-12345"), makeRes())).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("conflito do nucleo (409) se propaga para o cliente", async () => {
    mockedIdem.findOne.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new AppError("IDEMPOTENCY_CONFLICT", 409));

    await expect(store(makeReq("abc-12345"), makeRes())).rejects.toMatchObject({
      statusCode: 409
    });
  });

  it("lote de midia enfileira cada item com chave clientBatchId:{index}", async () => {
    mockCreate
      .mockResolvedValueOnce(acceptedCommand("cmd-0"))
      .mockResolvedValueOnce(acceptedCommand("cmd-1"))
      .mockResolvedValueOnce(acceptedCommand("cmd-2"));
    const req: any = {
      params: { ticketId: "10" },
      body: {
        body: ["foto-1", "foto-2", "foto-3"],
        clientBatchId: "batch-12345"
      },
      files: [
        { path: "/tmp/a", originalname: "a.jpg", mimetype: "image/jpeg" },
        { path: "/tmp/b", originalname: "b.jpg", mimetype: "image/jpeg" },
        { path: "/tmp/c", originalname: "c.jpg", mimetype: "image/jpeg" }
      ],
      user: { companyId: 1, id: "1", profile: "admin" }
    };
    const res = makeRes();

    await store(req, res);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockCreate.mock.calls.map(call => call[0].idempotencyKey)).toEqual([
      "batch-12345:0",
      "batch-12345:1",
      "batch-12345:2"
    ]);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyScope: "screen-media",
        kind: "image",
        payload: expect.objectContaining({
          localPath: "messaging/arquivo-1"
        }),
        origin: "screen"
      })
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      commands: [
        {
          commandId: "cmd-0",
          messageId: "cmd-0",
          status: "queued",
          replayed: false
        },
        {
          commandId: "cmd-1",
          messageId: "cmd-1",
          status: "queued",
          replayed: false
        },
        {
          commandId: "cmd-2",
          messageId: "cmd-2",
          status: "queued",
          replayed: false
        }
      ]
    });
  });

  it("mensagem citada da tela e propagada como quotedMessageId", async () => {
    mockCreate.mockResolvedValue(acceptedCommand());
    const res = makeRes();

    await store(makeReq(undefined, { quotedMsg: { id: "q-1" } }), res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ quotedMessageId: "q-1" })
    );
    expect(res.status).toHaveBeenCalledWith(202);
  });
});

const setupLegacyPathMocks = () => {
  mockedWhatsapp.findByPk.mockResolvedValue({ id: 2, companyId: 1 });
  mockedCheckNumber.mockResolvedValue({
    jid: "5511999999999@s.whatsapp.net"
  } as any);
  mockedProfilePic.mockResolvedValue("pic-url");
  mockedUpsertContact.mockResolvedValue({
    id: 55,
    number: "5511999999999"
  } as any);
  mockedFindOrCreateTicket.mockResolvedValue({ id: 10, companyId: 1 } as any);
  mockCreate.mockResolvedValue(acceptedCommand());
  mockFindReplay.mockResolvedValue(null);
};

describe("MessageController.send legado pelo outbox (Task 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupLegacyPathMocks();
  });

  it("midia do endpoint legado cria comandos no nucleo (sem fila Bull)", async () => {
    const req: any = {
      params: { whatsappId: "2" },
      body: { number: "5511999999999", body: "legenda" },
      files: [
        { path: "/tmp/a", originalname: "a.jpg", mimetype: "image/jpeg" },
        { path: "/tmp/b", originalname: "b.jpg", mimetype: "image/jpeg" }
      ],
      user: { companyId: 1, id: "1", profile: "admin" }
    };
    const res = makeRes();

    await send(req, res);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        idempotencyScope: "legacy-api-media",
        kind: "image",
        payload: expect.objectContaining({
          localPath: "messaging/arquivo-1",
          caption: "legenda"
        }),
        origin: "api"
      })
    );
    expect(res.send).toHaveBeenCalledWith({ mensagem: "Mensagem enviada" });
  });

  it("texto do endpoint legado passa pelo gate e cria comando legacy-api", async () => {
    const req: any = {
      params: { whatsappId: "2" },
      body: { number: "5511999999999", body: "ola" },
      files: undefined,
      user: { companyId: 1, id: "1", profile: "admin" }
    };
    const res = makeRes();

    await send(req, res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        idempotencyScope: "legacy-api",
        kind: "text",
        origin: "api"
      })
    );
    expect(res.send).toHaveBeenCalledWith({ mensagem: "Mensagem enviada" });
  });
});

describe("sendMessageFlow pelo outbox (Task 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setupLegacyPathMocks();
  });

  it("texto cria comando por recipient com o prefixo invisivel de paridade", async () => {
    const result = await sendMessageFlow(
      2,
      { number: "5511999999999", body: "oi", companyId: 1 },
      {} as any
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        whatsappId: 2,
        recipient: "5511999999999",
        idempotencyScope: "flow-api",
        kind: "text",
        origin: "automation"
      })
    );
    expect(mockCreate.mock.calls[0][0].text).toBe("‎ oi");
    expect(result).toBe("Mensagem enviada");
  });

  it("midia faz upload duravel e cria comando flow-api-media", async () => {
    const file: any = {
      path: "/tmp/v.mp4",
      originalname: "v.mp4",
      mimetype: "video/mp4"
    };

    await sendMessageFlow(
      2,
      { number: "5511999999999", body: "", companyId: 1 },
      {} as any,
      [file]
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyScope: "flow-api-media",
        whatsappId: 2,
        recipient: "5511999999999",
        payload: expect.objectContaining({
          localPath: "messaging/arquivo-1",
          caption: "v.mp4"
        }),
        origin: "automation"
      })
    );
  });
});

describe("replay de midia antes do staging (Task 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShowTicket.mockResolvedValue({ id: 10 } as any);
    mockedMessage.findByPk.mockResolvedValue({ id: "cmd-1" });
    mockedIdem.create.mockResolvedValue({});
    mockFindReplay.mockResolvedValue({
      command: { id: "cmd-0", messageId: "cmd-0", status: "queued" },
      ticket: {}
    });
  });

  it("retry do lote responde com os comandos originais sem mover arquivos", async () => {
    const req: any = {
      params: { ticketId: "10" },
      body: { body: ["foto-1", "foto-2"], clientBatchId: "batch-12345" },
      files: [
        { path: "/tmp/a", originalname: "a.jpg", mimetype: "image/jpeg" },
        { path: "/tmp/b", originalname: "b.jpg", mimetype: "image/jpeg" }
      ],
      user: { companyId: 1, id: "1", profile: "admin" }
    };
    const res = makeRes();

    await store(req, res);

    expect(mockFindReplay).toHaveBeenCalledTimes(2);
    expect(mockFindReplay).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyScope: "screen-media",
        idempotencyKey: "batch-12345:0",
        payload: expect.objectContaining({ fileName: "a.jpg" })
      })
    );
    expect(mockPersistUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
    const responseBody = res.json.mock.calls[0][0];
    expect(responseBody.commands).toHaveLength(2);
    expect(
      responseBody.commands.every((item: any) => item.replayed === true)
    ).toBe(true);
  });
});
