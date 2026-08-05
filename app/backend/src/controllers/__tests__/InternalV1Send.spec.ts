jest.mock("../../models/Contact", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Ticket", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/Message", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../models/V1MessageIdempotency", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), create: jest.fn() }
}));
jest.mock("../../libs/auditLog", () => ({
  audit: jest.fn(),
  requestIp: jest.fn(() => "127.0.0.1")
}));
jest.mock("../../services/InternalV1Services/Dtos", () => ({
  toContactDTO: jest.fn((value: any) => value),
  toConversationSummaryDTO: jest.fn((value: any) => value),
  toConversationMessageDTO: jest.fn((value: any) => value),
  encodeCursor: jest.fn(() => "cursor"),
  decodeCursor: jest.fn(() => null)
}));
const mockPersistUpload = jest.fn(async () => "messaging/arquivo-1");
jest.mock("../../messaging/application/persistMessagingUpload", () => ({
  persistMessagingUpload: mockPersistUpload,
  messageKindForMime: jest.fn(() => "image")
}));

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
import AppError from "../../errors/AppError";
import { sendConversationMessage } from "../InternalV1Controller";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";
import V1MessageIdempotency from "../../models/V1MessageIdempotency";
/* eslint-enable import/first */

const mockedTicket = Ticket as unknown as { findOne: jest.Mock };
const mockedMessage = Message as unknown as { findOne: jest.Mock };
const mockedIdem = V1MessageIdempotency as unknown as {
  findOne: jest.Mock;
  create: jest.Mock;
};

const makeReq = (): any => ({
  params: { conversationId: "10" },
  body: { clientMessageId: "cm-12345", body: "ola" },
  file: undefined,
  user: { companyId: 1, id: 9 }
});

const makeRes = (): any => {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe("InternalV1 sendConversationMessage pelo outbox (Task 4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedTicket.findOne.mockResolvedValue({
      id: 10,
      companyId: 1,
      whatsappId: 2,
      contact: { id: 55 }
    });
    mockedIdem.findOne.mockResolvedValue(null);
    mockedIdem.create.mockResolvedValue({});
    mockedMessage.findOne.mockResolvedValue({ id: "cmd-1" });
    mockFindReplay.mockResolvedValue(null);
  });

  it("primeiro envio: aceita no nucleo, responde 201 duplicate=false e mantem a ponte V1", async () => {
    mockCreate.mockResolvedValue({
      command: { id: "cmd-1", messageId: "cmd-1", status: "queued" },
      replayed: false
    });
    const res = makeRes();

    await sendConversationMessage(makeReq(), res);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        idempotencyScope: "internal-v1",
        idempotencyKey: "cm-12345",
        kind: "text",
        text: "ola",
        origin: "api"
      })
    );
    expect(mockedIdem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        clientMessageId: "cm-12345",
        messageId: "cmd-1"
      })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "cmd-1",
        clientMessageId: "cm-12345",
        conversationId: 10,
        duplicate: false
      })
    });
  });

  it("replay do nucleo: responde 200 duplicate=true sem regravar a ponte", async () => {
    mockCreate.mockResolvedValue({
      command: { id: "cmd-1", messageId: "cmd-1", status: "queued" },
      replayed: true
    });
    const res = makeRes();

    await sendConversationMessage(makeReq(), res);

    expect(mockedIdem.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "cmd-1", duplicate: true })
    });
  });

  it("conflito de idempotencia do nucleo vira 409 da API", async () => {
    mockCreate.mockRejectedValue(new AppError("IDEMPOTENCY_CONFLICT", 409));

    await expect(
      sendConversationMessage(makeReq(), makeRes())
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("chave da era sincrona responde replay sem chamar o nucleo", async () => {
    mockedIdem.findOne.mockResolvedValue({ messageId: "wa-old-1" });
    mockedMessage.findOne.mockResolvedValue({ id: "wa-old-1" });
    const res = makeRes();

    await sendConversationMessage(makeReq(), res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "wa-old-1", duplicate: true })
    });
  });

  it("retry de midia: replay antes do staging, sem novo upload nem comando", async () => {
    mockFindReplay.mockResolvedValue({
      command: { id: "cmd-1", messageId: "cmd-1", status: "queued" },
      ticket: {}
    });
    const req = {
      ...makeReq(),
      file: {
        path: "/tmp/x",
        originalname: "foto.jpg",
        mimetype: "image/jpeg"
      }
    };
    const res = makeRes();

    await sendConversationMessage(req, res);

    expect(mockPersistUpload).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: "cmd-1", duplicate: true })
    });
  });
});
