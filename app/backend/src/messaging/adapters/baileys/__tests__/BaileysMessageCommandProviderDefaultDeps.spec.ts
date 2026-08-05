const mockAdapter = {
  sendText: jest.fn(),
  sendContent: jest.fn(),
  sendNativeButtons: jest.fn()
};
jest.mock("../getBaileysTicketMessagingProvider", () => ({
  __esModule: true,
  default: mockAdapter
}));

// Anti-SSRF: midia remota passa pelo fetcher controlado e chega ao adapter
// apenas como arquivo staged local — nunca como URL.
jest.mock("../../../application/fetchRemoteMediaSecurely", () => ({
  fetchRemoteMediaSecurely: jest
    .fn()
    .mockResolvedValue("messaging/staged-foto.jpg")
}));

/* eslint-disable import/first */
import BaileysMessageCommandProvider from "../BaileysMessageCommandProvider";
/* eslint-enable import/first */

const ticket = { id: 17, contact: { number: "5511999999999" } };
const quotedRow = {
  id: "upfront-9",
  remoteJid: "5511999999999@s.whatsapp.net",
  fromMe: true,
  body: "contexto",
  dataJson: JSON.stringify({
    kind: "text",
    text: "contexto",
    origin: "screen"
  })
};

// Usa os wrappers DEFAULT (sem injetar sendText/sendContent): o caminho de
// producao precisa encaminhar o quoted resolvido ate o adapter real.
const makeProvider = () =>
  new BaileysMessageCommandProvider({
    findTicket: jest.fn().mockResolvedValue(ticket),
    findQuotedMessage: jest.fn().mockResolvedValue(quotedRow)
  });

describe("BaileysMessageCommandProvider — wrappers default encaminham quoted ao adapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAdapter.sendText.mockResolvedValue({ key: { id: "wamid_default" } });
    mockAdapter.sendContent.mockResolvedValue({
      key: { id: "wamid_default_media" }
    });
  });

  it("texto com quotedMessageId chega ao adapter com o quoted sintetizado", async () => {
    const provider = makeProvider();

    await provider.send({
      id: "cmd_d1",
      companyId: 10,
      whatsappId: 2,
      provider: "baileys",
      messageKind: "text",
      recipient: "5511999999999",
      requestPayload: {
        ticketId: 17,
        text: "ola",
        quotedMessageId: "upfront-9"
      }
    });

    expect(mockAdapter.sendText).toHaveBeenCalledWith({
      ticket,
      text: "ola",
      messageId: "cmd_d1",
      quoted: {
        key: {
          id: "upfront-9",
          remoteJid: "5511999999999@s.whatsapp.net",
          fromMe: true
        },
        message: { extendedTextMessage: { text: "contexto" } }
      }
    });
  });

  it("midia com quotedMessageId chega ao adapter com o quoted", async () => {
    const provider = makeProvider();

    await provider.send({
      id: "cmd_d2",
      companyId: 10,
      whatsappId: 2,
      provider: "baileys",
      messageKind: "image",
      recipient: "5511999999999",
      requestPayload: {
        ticketId: 17,
        link: "https://cdn.example.com/foto.jpg",
        quotedMessageId: "upfront-9"
      }
    });

    expect(mockAdapter.sendContent).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket,
        messageId: "cmd_d2",
        quoted: expect.objectContaining({
          key: expect.objectContaining({ id: "upfront-9" })
        })
      })
    );
  });
});
