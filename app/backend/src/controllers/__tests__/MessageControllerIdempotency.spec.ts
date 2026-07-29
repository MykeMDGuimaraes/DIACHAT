import { UniqueConstraintError } from "sequelize";
import AppError from "../../errors/AppError";

jest.mock("../../helpers/SetTicketMessagesAsRead", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../libs/socket", () => ({ getIO: jest.fn() }));
jest.mock("../../models/Message", () => ({
  __esModule: true,
  default: { findByPk: jest.fn(), findOne: jest.fn() }
}));
jest.mock("../../models/Queue", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/User", () => ({ __esModule: true, default: {} }));
jest.mock("../../models/Whatsapp", () => ({ __esModule: true, default: {} }));
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
jest.mock("../../services/WbotServices/SendWhatsAppMedia", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/SendWhatsAppMessage", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/CheckNumber", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/CheckIsValidContact", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../services/WbotServices/GetProfilePicUrl", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock(
  "../../services/ContactServices/CreateOrUpdateContactService",
  () => ({ __esModule: true, default: jest.fn() })
);

/* eslint-disable import/first */
import { store } from "../MessageController";
import ShowTicketService from "../../services/TicketServices/ShowTicketService";
import SendWhatsAppMessage from "../../services/WbotServices/SendWhatsAppMessage";
import V1MessageIdempotency from "../../models/V1MessageIdempotency";
import Message from "../../models/Message";
/* eslint-enable import/first */

const mockedShowTicket = ShowTicketService as jest.MockedFunction<
  typeof ShowTicketService
>;
const mockedSend = SendWhatsAppMessage as jest.MockedFunction<
  typeof SendWhatsAppMessage
>;
const mockedIdem = V1MessageIdempotency as unknown as {
  findOne: jest.Mock;
  create: jest.Mock;
};
const mockedMessage = Message as unknown as { findByPk: jest.Mock };

const makeReq = (clientMessageId?: string): any => ({
  params: { ticketId: "10" },
  body: { body: "hello", clientMessageId },
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

describe("MessageController.store idempotency", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedShowTicket.mockResolvedValue({ id: 10 } as any);
  });

  it("sends normally without clientMessageId", async () => {
    mockedSend.mockResolvedValue({ key: { id: "wa-1" } } as any);
    const res = makeRes();
    await store(makeReq(), res);
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(mockedIdem.findOne).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });

  it("creates the key, sends once and stores messageId", async () => {
    mockedIdem.findOne.mockResolvedValue(null);
    const record = { update: jest.fn(), destroy: jest.fn() };
    mockedIdem.create.mockResolvedValue(record);
    mockedSend.mockResolvedValue({ key: { id: "wa-1" } } as any);

    const res = makeRes();
    await store(makeReq("abc"), res);

    expect(mockedIdem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 1,
        ticketId: 10,
        clientMessageId: "abc"
      })
    );
    expect(mockedSend).toHaveBeenCalledTimes(1);
    expect(record.update).toHaveBeenCalledWith({ messageId: "wa-1" });
    expect(res.send).toHaveBeenCalled();
  });

  it("returns the already-created message on a repeated key without re-sending", async () => {
    mockedIdem.findOne.mockResolvedValue({ messageId: "wa-1" });
    mockedMessage.findByPk.mockResolvedValue({ id: "wa-1", body: "hello" });

    const res = makeRes();
    await store(makeReq("abc"), res);

    expect(mockedSend).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ id: "wa-1", body: "hello" });
  });

  it("rejects with 409 while the original request is still in flight", async () => {
    mockedIdem.findOne.mockResolvedValue({ messageId: null });

    await expect(store(makeReq("abc"), makeRes())).rejects.toMatchObject({
      statusCode: 409
    });
    expect(mockedSend).not.toHaveBeenCalled();
  });

  it("handles a concurrent duplicate insert (unique constraint race)", async () => {
    mockedIdem.findOne
      .mockResolvedValueOnce(null) // initial lookup
      .mockResolvedValueOnce({ messageId: "wa-9" }); // after constraint error
    mockedIdem.create.mockRejectedValue(
      new UniqueConstraintError({ errors: [] })
    );
    mockedMessage.findByPk.mockResolvedValue({ id: "wa-9" });

    const res = makeRes();
    await store(makeReq("abc"), res);

    expect(mockedSend).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ id: "wa-9" });
  });

  it("frees the key when the send fails so a retry can go through", async () => {
    mockedIdem.findOne.mockResolvedValue(null);
    const record = { update: jest.fn(), destroy: jest.fn().mockResolvedValue(undefined) };
    mockedIdem.create.mockResolvedValue(record);
    mockedSend.mockRejectedValue(new AppError("ERR_SENDING_WAPP_MSG"));

    await expect(store(makeReq("abc"), makeRes())).rejects.toBeInstanceOf(
      AppError
    );
    expect(record.destroy).toHaveBeenCalled();
  });
});
