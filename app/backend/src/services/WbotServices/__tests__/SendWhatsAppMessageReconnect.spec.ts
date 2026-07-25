import AppError from "../../../errors/AppError";

jest.mock("baileys", () => ({ __esModule: true, default: {} }));
jest.mock("@sentry/node", () => ({ captureException: jest.fn() }));
jest.mock("../../../helpers/GetTicketWbot", () => ({
  __esModule: true,
  default: jest.fn()
}));
jest.mock("../../../models/Message", () => ({
  __esModule: true,
  default: { findOne: jest.fn() }
}));
jest.mock("../../../models/Ticket", () => ({
  __esModule: true,
  default: class Ticket {}
}));
jest.mock("../../../helpers/Mustache", () => ({
  __esModule: true,
  default: (body: string) => body
}));

// eslint-disable-next-line import/first
import SendWhatsAppMessage from "../SendWhatsAppMessage";
// eslint-disable-next-line import/first
import GetTicketWbot from "../../../helpers/GetTicketWbot";

const mockedGetTicketWbot = GetTicketWbot as jest.MockedFunction<
  typeof GetTicketWbot
>;

const makeTicket = (): any => ({
  contact: { number: "5511999999999" },
  isGroup: false,
  update: jest.fn()
});

describe("SendWhatsAppMessage during reconnection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requests the socket with a reconnect wait window", async () => {
    const sendMessage = jest.fn().mockResolvedValue({ key: { id: "abc" } });
    mockedGetTicketWbot.mockResolvedValue({ sendMessage } as any);

    const ticket = makeTicket();
    const sent = await SendWhatsAppMessage({ body: "oi", ticket });

    expect(sent).toEqual({ key: { id: "abc" } });
    expect(mockedGetTicketWbot).toHaveBeenCalledWith(ticket, {
      waitForReconnectMs: 45000
    });
    expect(sendMessage).toHaveBeenCalled();
  });

  it("propagates ERR_WAPP_NOT_AVAILABLE when the reconnect window expires", async () => {
    mockedGetTicketWbot.mockRejectedValue(
      new AppError("ERR_WAPP_NOT_AVAILABLE", 503)
    );

    await expect(
      SendWhatsAppMessage({ body: "oi", ticket: makeTicket() })
    ).rejects.toMatchObject({
      message: "ERR_WAPP_NOT_AVAILABLE",
      statusCode: 503
    });
  });

  it("keeps ERR_SENDING_WAPP_MSG for unexpected send failures", async () => {
    const sendMessage = jest.fn().mockRejectedValue(new Error("boom"));
    mockedGetTicketWbot.mockResolvedValue({ sendMessage } as any);

    await expect(
      SendWhatsAppMessage({ body: "oi", ticket: makeTicket() })
    ).rejects.toMatchObject({ message: "ERR_SENDING_WAPP_MSG" });
  });
});
